# Scripts: sync

Queries pending artists (`lastIndexedAt > lastSyncedAt`, or never synced — but only artists that **have** a `lastIndexedAt`: one with NULL is never selected at all, see `docs/sync_decisions.md` §19 item 13) and syncs each against MusicBrainz. Uses a run hash for resumability - interrupted runs skip already-processed artists. Reads from DB and calls MB API. Writes found MB IDs back to audio file tags (preserving mtime to avoid re-index) and embeds downloaded cover art.

Artists that only hold track credits ("appears on", owning no release here) are deliberately not synced -
they are excluded by `EXISTS(LocalReleaseArtist)` rather than by a stored flag. See
`docs/scripts/index.md`'s Artist Resolution section.

## TL;DR

1. Load config, connect DB, acquire process lock (prevents concurrent runs)
2. Select artists: `--release` (single), `--overwrite` (all), or default (pending where `lastIndexedAt > lastSyncedAt` **or** the artist has any `LocalRelease` at `matchStatus = UNKNOWN`, e.g. left by a box dissolve - see §7 of `docs/sync_decisions.md`). Skip artists already processed in current run (matching `syncHash`)
3. **Per artist:**
   - Skip special names (Various Artists, [unknown])
   - Find on MusicBrainz - use existing MB ID or search API; skip duplicates (same MB ID as previous artist)
   - Persist MB ID and country code (from MB area ISO 3166-1), fetch artist details (genres, tags, URLs), upsert to DB
   - Download artist image if missing (Wikidata → Wikipedia → Fanart.tv → local/S3)
   - Fetch release groups from MB API
4. **Per release (within artist):**
   - Skip already-synced (has `releaseId`) unless `--overwrite` or its status is `UNKNOWN` (index flagged it for recalculation after deleting tracks)
   - Match: Tier 1 (MUSICBRAINZ_ALBUMID) → Tier 2 (MUSICBRAINZ_RELEASEGROUPID) → Tier 3 (title+artist search, only when no usable MB-id consensus) → no match = UNMATCHED
   - Majority id must be a real consensus (unanimous, or a strict plurality ≥2); a folder of all-distinct per-source ids yields no consensus
   - **Agreement, not just plurality** (`tags_agree_on`): Tier 1 binds by tag directly only when the id — or its release group — is carried by more than half the tagged tracks. A plurality that is not an agreement (a per-track-tagged compilation) is looked up but bound only if its tracklist scores COMPLETE; otherwise the folder stays UNMATCHED and is deliberately *not* searched (its title is the same scattered tag). Tier 2 browses only a release group most tracks agree on. See `docs/sync_decisions.md` §7
   - **Allow-list**: bind only Official Album/EP release-groups (rejects Broadcast/Other, non-Official/bootleg, and non-music secondary types). A Single-typed group binds only when the *files' own* MB ids point at it; a rejected candidate gets one search-tier retry before going Unmatched
   - Compare local vs MB track counts → status: COMPLETE / EXTRA_TRACKS / MISSING_TRACKS / INCOMPLETE
   - If ambiguous (multiple editions, no exact track-count match) → UNMATCHED
   - Upsert MB release, link tracks, update local release match status. Marking a release UNMATCHED also clears its tracks' `mbTrackId` links
5. **Cover art (batched per artist):** download from Cover Art Archive, embed into audio files, extract thumbnail → `img/releases/` (local/S3)
6. **Cleanup:** update artist sync stats + global statistics, delete orphan MB releases, release lock

## Build

```bash
cd scripts && cargo build --release -p sync
```

## Usage

```bash
./sync                           # Sync all pending artists
./sync --only "radiohead"        # Single artist (prefix match)
./sync --only "Air" --exact      # Exact match (won't catch "Airbag")
./sync --from "A" --to "M"      # Letter range
./sync --release "clxxxxxxx"    # Re-sync a single release by LocalRelease ID
./sync --overwrite               # Re-sync all (ignores lastSyncedAt)
./sync --skip-artist-img         # Skip artist image downloads
./sync --skip-release-img        # Skip cover art downloads
./sync --verbose                 # Show skipped MB releases
./sync --delete                  # Delete MB data for matched artists, then exit
./sync --catalogue-gaps          # Fast pass: populate MISSING catalogue entries only (few API calls/artist)
./sync --catalogue-gaps --only x # Gaps for specific artist
./sync --catalogue-gaps --overwrite # Re-fetch all MISSING entries from scratch
./sync --skip-mb-tags            # Skip writing MB IDs back to file tags
./sync --only-write-mb-to-files  # Backfill DB-known MB IDs into file tags (no API calls)
./sync --only-write-mb-to-files --only "radiohead"  # Backfill specific artist
./sync --web                     # Emit PROGRESS:{json} for the web terminal
./sync --release "clxxx" --artist-hint "clyyy"  # Prefer this artist when the release has several main artists
```

Sync does per-artist matching only. Every library-wide repair - box-set fold/dissolve, artist identity
repair, score recompute, empty/orphaned release cleanup - moved to `./tidy`, which every caller chains
after `./sync` (`docs/scripts/tidy.md`). Sync itself never calls tidy.

`--release` cannot combine with `--from`, `--to`, or `--only`.

## CLI Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--from` / `-f` | String | - | Start letter filter |
| `--to` / `-t` | String | - | End letter filter |
| `--only` / `-o` | String | - | Artist filter (semicolon-separated) |
| `--exact` | bool | false | Exact match for `--only` (no prefix matching) |
| `--release` | String | - | Re-sync single release by LocalRelease ID |
| `--overwrite` | bool | false | Re-sync all matched (not just pending) |
| `--skip-artist-img` | bool | false | Skip artist image download |
| `--skip-release-img` | bool | false | Skip release cover download |
| `--delete` | bool | false | Nuke MB data for matched artists, then exit |
| `--catalogue-gaps` | bool | false | Fast pass: only populate MISSING catalogue entries (few API calls/artist) |
| `--skip-mb-tags` | bool | false | Skip writing found MB IDs back into audio file tags |
| `--only-write-mb-to-files` | bool | false | Backfill DB-known MB IDs into file tags (no API calls), then exit |
| `--verbose` | bool | false | Log skipped/already-synced releases |
| `--concurrency` | usize | 6 | Artists synced at once. Not a rate knob — see § Rate Limiting |
| `--web` | bool | false | Emit PROGRESS:{json} for web terminal |
| `--artist-ids` | String | - | Read artist IDs from file (one per line, used by refresh) |
| `--artist-hint` | String | - | With `--release`: prefer this Artist ID when the release has several main artists |

## Output Modes

Without `--web`: colored console progress with rate-limit countdown. With `--web`: `PROGRESS:{json}` lines for the web UI. The web UI appends `--web` automatically.

## Per-Artist Flow

1. **Find MB match** - 5-step algorithm (see below)
2. **Fetch** artist detail: URLs, genres (top 5 by count), tags, country (from `area.iso-3166-1-codes`)
3. **Download** artist image (Wikidata → Wikipedia → Fanart.tv), resize to 500px — **spawned, not awaited** (max 4 in flight). None of those hosts is MusicBrainz, so the fetches consume no MB rate budget; awaiting them inline left the limiter idle for hours across the ~20k artists still missing an image. Results are reported by artist name as they land, so a line may appear while a later artist is syncing. Ctrl-C abandons in-flight downloads — the fetch is gated on the artist having no image, so the next run picks it up.
4. **Fetch** release groups (paginated)
5. **For each local release** - 3-tier matching (see Release Matching Policy):
   - Tier 1: Direct release lookup via embedded `MUSICBRAINZ_ALBUMID` (consensus vote across tracks)
   - Tier 2: Release group browse via `MUSICBRAINZ_RELEASEGROUPID` (or Tier 1 404 fallback)
   - Tier 3: MB search by album title + artist — when the release carries no usable MB-id consensus (per-source-tagged comps), and once as a retry after the allow-list rejects a tagged candidate; gated hard so it never mis-binds
   - Every candidate passes the allow-list before binding (Official Album/EP, plus Single when the files' own ids point at it); no consensus and no confident search hit → marked Unmatched
6. **Link** LocalReleaseTrack → MusicBrainzReleaseTrack where titles match
7. **Write MB IDs** back to audio file tags (`MUSICBRAINZ_ALBUMARTISTID`, `MUSICBRAINZ_ALBUMID`, `MUSICBRAINZ_RELEASEGROUPID`, `MUSICBRAINZ_RELEASETRACKID` = release-track id, `MUSICBRAINZ_TRACKID` = recording id; ID3 uses Picard's TXXX descriptions + `UFID:http://musicbrainz.org` for the recording) - only fills tags that are absent; never overwrites an existing value unless `--overwrite` is passed (deliberate re-correction, e.g. after fixing a bad match). Preserves file mtime to avoid triggering re-index. Skipped with `--skip-mb-tags`. A file with no tag block at all gets one created so IDs can still be written.
8. **Cover art** - download from Cover Art Archive (release-level first, release-group fallback), embed into audio file tags, then re-extract 200x200 thumbnails via same pipeline as index (`common/src/images.rs`)
9. **Set `lastSyncedAt`** on Artist, persist country code, compute completeness
10. **Stamp run hash** on Artist for resumability

Duplicate detection: tracks processed MB IDs across the run. Skips artists that resolve to an already-processed MB artist.

## --catalogue-gaps Behaviour

Fast path for populating MISSING MusicBrainzRelease entries without re-running the full sync. Requires artists to already have `musicbrainzId` in DB (from a previous full sync).

Two ways to scope it: name filtering (`--only`/`--from`/`--to`/`--exact`, this binary's own flags), or
an explicit `artist_ids: Option<&[String]>` param on `fill_catalogue_gaps` itself, used only by `./add`
(docs/scripts/add.md) — it scopes to the single artist id it just created rather than a name match, so
two same-named artists never cross and a name containing `;` needs no special handling. `./sync`'s own
CLI always passes `None` here.

**Per artist (a few API calls):**
1. Use existing `musicbrainzId` from DB (no search/lookup)
2. Fetch release groups from MB API
3. Fetch the artist's Official Album/EP releases (paginated, ~1–4 calls) to learn which groups have an Official release — see "Official-only gaps"
4. Query existing artist genres from DB (no API call)
5. If `--overwrite`, delete stale MISSING entries first; otherwise skip release groups that already have MISSING entries
6. Create MISSING entries for uncovered, official Album/EP release groups + link genres

**Skips entirely:** artist search, artist detail fetch, URL upsert, artist image, local release matching, cover art download.

**Skip logic:** Without `--overwrite`, existing MISSING releases are preserved and only new gaps are added. With `--overwrite`, all MISSING releases are deleted and re-created from scratch.

**Performance:** 1 release-group browse + the artist catalogue browse (1 page for a typical artist, ~11 for a Radiohead-sized one — `inc=recordings` pages are size-capped). Both paths share the same catalogue, so containment costs no calls of its own here either.

Cannot combine with `--release` or `--delete`. Compatible with `--from`/`--to`/`--only`/`--exact`/`--overwrite`/`--web`/`--verbose`.

## --only-write-mb-to-files Behaviour

Writes DB-known MB IDs back into audio file tags. No API calls - reads entirely from DB. Only fills in **absent** tags unless `--overwrite` is passed, which replaces existing values. Preserves file mtime to avoid triggering re-index.

**Per artist:** queries all matched tracks (joined through LocalRelease → MusicBrainzRelease → MusicBrainzReleaseTrack), writes missing `MUSICBRAINZ_ALBUMARTISTID`, `MUSICBRAINZ_ALBUMID`, `MUSICBRAINZ_RELEASEGROUPID`, `MUSICBRAINZ_RELEASETRACKID` (release-track id) and `MUSICBRAINZ_TRACKID` (recording id, from `MusicBrainzReleaseTrack.recordingId`, skipped while that is NULL) tags.

**Use case:** backfill tags after a full sync so files become source of truth. Run once after initial sync to persist all found MB IDs into files.

Cannot combine with `--release`, `--delete`, or `--catalogue-gaps`. Compatible with `--from`/`--to`/`--only`/`--exact`/`--overwrite`.

## Recording-tag mixup (historical)

Until 2026-09, `common::tags::write_mb_ids` wrote each track's **release-track** id into the **recording** slot (`MUSICBRAINZ_TRACKID` / ID3 UFID / MP4 `MusicBrainz Track Id`: Picard's names, which say "track" but mean the recording). A normal sync filled it wherever the tag was empty, and `--overwrite` replaced correct Picard values with it. MP3s were spared only by accident: lofty's generic ID3v2 conversion dropped the frame, see the MP3 note in `CLAUDE.md`.

The one-off `oneoff/repair_recording_tags.py` repaired the already-damaged files library-wide on
2026-09-18 (it had failed to start on the NAS's Python 3.11 until then — see
`docs/scripts/tidy_observations.md` §17 for the run) and was then deleted along with the rest of
`oneoff/`. There is no standing flag for
this anymore - a normal sync still heals as it goes (`write_mb_ids` treats a recording tag equal to the
track's own release-track id as absent, without `--overwrite`), so the mixup cannot recur.

## --delete Behaviour

Resets `musicbrainzId`, `completeness`, and `lastSyncedAt` to NULL, unlinks `MusicBrainzRelease` records, resets `LocalRelease.matchStatus` to `UNMATCHED`. Re-running `./sync` after this automatically re-syncs those artists.

The unlink statement used to set `statusReason` as well. That column lives on `MusicBrainzRelease`, not `LocalRelease`, so the statement errored - and here the error was propagated with `?`, aborting the unlink part-way through and leaving the rest of the artist's releases still bound to MB. Removed.

## Artist Matching (5-step)

1. Embedded MB artist ID in any track tag → direct lookup
2. Embedded MB album ID → release-group credits lookup
3. Name search (phrase-quoted, score >= 90, Jaccard >= 0.5)
4. Raw track artist tag search (when differs from album artist)
5. Release-group credits search by album title + artist name

If artist already has a MB ID and not overwriting: uses it directly (no API search).

### Shared lookup cache (read-only)

Every search step (3, 4, 6) consults `MbArtistLookup` before spending a request. That table is filled
by index's artist-resolution pass, which has usually already asked MusicBrainz about these exact
strings — 9,507 artists in this library carry no `musicbrainzId` and fall into this ladder, and before
this they re-paid for those answers every run. The artist names known at startup are bulk-loaded in one
query (`common::mb::cache::warm_exact_artists`); tags discovered mid-ladder use a point lookup.

Two rules, and they are not stylistic:

- **Hits only.** A cached *miss* is the strict resolver's answer (`mb_search_artist_exact`). Sync's
  search is fuzzy (`mb_search_artist`) and may still match where the strict one didn't, so a miss must
  fall through rather than short-circuit.
- **Sync never writes to `MbArtistLookup`.** Its fuzzy matcher scores "Frank Sinatra with Count Basie"
  against "Frank Sinatra" at exactly 0.5 and passes, so feeding results back would confirm nearly every
  compound tag as a single artist and corrupt the resolver's decisions for every later run. See
  `common/src/mb/cache.rs`.

## Release Matching Policy

Metadata-wins with a guarded search fallback. Three tiers, tried in order; embedded MB ids always win first.

### Consensus (`get_majority_id`)

Tiers 1 and 2 use a **consensus** of the tracks' embedded ids, not an arbitrary pick. The majority id is accepted only if it is **unanimous** (the only distinct id) or a **strict plurality** (count ≥ 2 and strictly greater than any rival). A compilation folder whose tracks each carry their *original source's* id has no consensus → those tiers don't fire (it falls to Tier 3 or `UNMATCHED`). This is what stops a comp from binding to one arbitrary source single.

### Allow-list (`scripts/common/src/mb/allowlist.rs`)

Before any bind, the candidate must pass `is_allowed`:
- release-group **primary type** ∈ {Album, EP} (rejects Single, Broadcast, Other);
- release **status** = Official (rejects bootleg/promotion/pseudo-release; missing status is treated as Official, matching the Tier-2 browse filter);
- no **rejected secondary type** (audiobook, audio drama, spokenword, interview, field recording, demo). Compilation / Live / Remix / Soundtrack ride on an Album/EP primary type and pass. Remasters/special editions aren't MB types — they're Album primary and pass automatically.

The same allow-list gates `--catalogue-gaps` MISSING creation. Net effect: **the library never
searches for, browses or invents a Single.**

### The tagged exception (`is_allowed_tagged`)

One case gets a wider gate: a candidate the **files themselves point at** — a unanimous embedded
`MUSICBRAINZ_ALBUMID` (Tier 1) or `MUSICBRAINZ_RELEASEGROUPID` (Tier 2). There, a Single-typed group
passes; status and secondary-type rules are unchanged. MusicBrainz files a lot of owned 4-track CD
"EP"s under a Single group — Radiohead's 1993 `Creep` (release `130fe36f…`, Official, GB, 4/4 exact
match) is the canonical one, and it sat `UNMATCHED` purely because of its group's type. The tags are
definitive about a disc that is already on disk.

Those bind and enter the catalogue **typed `Single`**, which the artist page's Singles filter and
counts already understand. Search hits (Tier 3) and catalogue gaps keep using `is_allowed`, so nothing
ever *invents* a Single — only a disc you own can produce one. `MatchCandidate.from_tags` is what
selects the gate.

### Recordings already inside another release (`scripts/sync/src/owned.rs`)

Coverage is computed from binds, and a `LocalRelease` can only point at one MB release — so a release
reissued inside something bigger **has no bind of its own**. `Radiohead/EP/2009 - In Rainbows Disk 2`
physically holds CD 01 + CD 02 (18 tracks, tagged `album = In Rainbows`, no MB ids), binds to the *In
Rainbows* group, and leaves MusicBrainz's separate `In Rainbows Disk 2` group looking uncovered. The
same shape covers box sets and complete-recordings collections: a folder holding
*The Complete Blue Note 1964-66 Jackie McLean Sessions* contains every track of `Right Now!`.

**Containing those recordings is not owning that release.** A box set's rendition is a different
edition, usually a different master, often different edits or takes — which is exactly why MusicBrainz
models it as a separate release. DMP exists to tell a collector what they actually hold, so a contained
release stays `MISSING`, stays counted as a gap, and stays acquirable. `detect_containment` only
annotates it, so the collector can see where those songs already are before deciding.

`detect_containment` is pure — it scores tracklists it is handed. Those come from
`mb_get_official_artist_catalogue`, the one artist-scoped browse sync already makes to learn which
groups have an Official release; adding `+recordings` to it returns every one of those releases'
tracklists for free. It used to fetch its own, one paginated browse **per gap, per artist, per run**,
never caching a negative result — 14.8 such calls for an average artist, 184 at p99, 813 at worst,
each averaging ~10s cold. That was the single largest avoidable cost in a sync run.

One consequence: only **Official** editions are considered now, where a per-group fetch also kept
editions whose status is absent. Every gap reaching this check has already passed `is_allowed_gap`,
which requires the group to have an Official release, so an edition is always available; the narrowing
is confined to `statusReason` and can never change `matchStatus` or ownership.

Detection requires all of:

- every MB track matched to a **distinct** local track by normalized title (case/punctuation-insensitive);
- durations within **±5s** where both are known — `In Rainbows: From the Basement` is the same ten
  songs played live and passed a title-only rule; its takes run 1–33s off the studio ones, and since
  every track must match, one honest outlier refuses it;
- the local release is a **strict superset** (an exact-size match belongs to the matcher, which binds it);
- at least 3 MB tracks (a one- or two-track "release" matches by coincidence inside any album).

On a hit the gap is written with `statusReason = 'Recordings inside "<container>"'` and nothing else.
`detect_containment` is read-only: no MB release rows, no track rows, **no `LocalReleaseTrack.mbTrackId`
links**, no file writes, no queue rejections. The web side reads the note through
`containmentContainerTitle()` (`web/helpers/functions.ts`), resolves the named container to a local
release for the click-through, and renders a muted badge on a row that is still, visibly, a gap.

Detection costs one MB call per uncovered group, so the note is carried across syncs:
`get_contained_notes_for_artist` snapshots it before the gap pass wipes and rewrites the rows, and only
`--overwrite` pays to re-derive it.

> **History.** Until 2026-09 this was `claim_owned_bundle`, which marked the contained release
> `COMPLETE`, rejected its queued downloads, and linked the *container's* local tracks to the contained
> release's MB tracks — overwriting their real MB identity and making `sync --only-write-mb-to-files`
> stamp a mismatched album/track id pair into the files. On the live library that was 1,583 releases
> reported as owned that were not, and 11,162 mis-pointed track rows.
> `scripts/sql/undo_owned_bundle_claims.sql` reverses both.

### Rejected candidates fall back to search

An allow-list rejection used to be a dead end: the release was marked `UNMATCHED` and that was that.
Files tagged with a **bootleg** edition's release id therefore stayed unmatched forever even when the
official album was one search away — Radiohead's `A Moon Shaped Pool` was tagged
`7c2cae71…` (status Bootleg) and showed up as *missing* in the same catalogue that held the local copy.
Now a rejected tagged candidate gets one Tier-3 search attempt (`search_release_candidate`, shared with
Tier 3 proper) before giving up. The tags still win whenever they are usable; the fallback only runs
after they have already been refused.

### Official-only gaps (`is_allowed_gap`)

A **release group carries no status** — status lives on the releases inside it — so for a catalogue gap
(no local copy, no chosen release) `is_allowed` sees `status = None` and treats the group as Official.
That is how bootleg soundboard recordings flooded the catalogue: they are primary type Album with a
Live secondary type, structurally identical to an official live album, which we keep on purpose.
Radiohead ended up with **366** MISSING entries, nearly all bootlegs.

Both gap paths (the end-of-artist block in `main.rs` and `--catalogue-gaps`) now call
`mb_get_official_release_group_ids` once per artist: browse
`/release?artist=…&status=official&type=album|ep&inc=release-groups`, paginated, collecting the groups
that actually have an Official release. `is_allowed_gap` = that set ∧ `is_allowed`. Radiohead: 366 → 13.
Server-side filtering keeps this to ~4 extra calls even for an artist with 500 releases; asking per
group would have been one call per gap. If the lookup fails, the artist's existing MISSING rows are
left untouched rather than rewritten from unfiltered data.

### The three tiers

- **Tier 1** — direct lookup by `MUSICBRAINZ_ALBUMID` consensus.
- **Tier 2** — release-group browse by `MUSICBRAINZ_RELEASEGROUPID` consensus (or a Tier-1 404 fallback). `mb_get_release_tracks` returns only Official editions; `check_release_status` then picks the edition (exact track-count sibling preferred; a single-edition group binds directly and records `MISSING_TRACKS`/`EXTRA_TRACKS` as appropriate). A deluxe/edition upgrade re-checks the group when the local folder has *more* tracks than the bound edition.
- **Tier 3 (search fallback)** — runs when the release has no usable embedded MB-id consensus, and once more as a retry after the allow-list rejects a tagged candidate. Searches MB by album title + artist (`mb_search_release_groups`, limit 5) and takes the **first hit in the shortlist** that satisfies all of: MB score ≥ 85, the found release-group title is similar to the local album (`names_are_similar`), the type passes the allow-list; a browsed edition must then be track-count-confident. Scanning the shortlist rather than the top hit is load-bearing — MusicBrainz scores `Amnesiac` **the single** at 100 ahead of `Amnesiac` the album, so taking only the best hit left a 26-track album Unmatched. It never overrides an embedded id and never binds a Single (only tagged candidates may), so distinct editions are not collapsed. This is the narrow, gated re-opening of the formerly-disabled fuzzy matching.

Found MB ids are written back to file tags after matching, so future syncs (or DB rebuilds) can skip expensive MB work. The writeback preserves file mtime to avoid triggering re-index.

> **Duplicate copies bind freely.** The former shared-releaseId guard (audit #24), which unmatched any release whose MB release was already bound to another `LocalRelease`, has been **removed** — with folder-grouping, multiple `LocalRelease` rows legitimately map to one MB release (duplicate folder-copies of the same album). They all bind now; the `duplicate-release` audit rule surfaces them for review instead of blocking them at match time.

## Release Status

All statuses in `ReleaseStatus` enum and how they are assigned:

| Status | Score | How assigned | Badge color |
|--------|-------|--------------|-------------|
| `COMPLETE` | 1.0 | Sync: all MB tracks matched to local tracks (0 unmatched on both sides) | Green |
| `EXTRA_TRACKS` | 0.85 | Sync: more local tracks than MB tracks | Blue |
| `MISSING_TRACKS` | 0.7 | Sync: MB has tracks not found locally | Orange |
| `INCOMPLETE` | 0.5 | Sync: fallback when some local tracks are unmatched | Amber |
| `MISSING` | - | API-only: MB release exists in artist catalogue but no local files | Red |
| `UNKNOWN` | - | Index: track deletion resets matched release for sync recalculation. Release still has `releaseId`. | Gray |
| `UNMATCHED` | - | Index: new release (no MB match yet). Sync: no MB-id consensus and no confident Tier-3 search hit, disallowed type/status that the search fallback could not replace, or ambiguous edition (multiple MB siblings, no exact track-count match). Nuke: unlink from MB. | Beige |

### Status lifecycle

1. **Index creates** a new `LocalRelease` → `UNMATCHED` (no MB link yet)
2. **Sync matches** release to MB → `COMPLETE`/`EXTRA_TRACKS`/`MISSING_TRACKS`/`INCOMPLETE`
3. **Sync can't match** (no MB tags or ambiguous) → stays `UNMATCHED`
4. **Track deletion** on a matched release → `UNKNOWN` (needs sync recalculation, `releaseId` kept)
5. **Nuke/delete** unlinks from MB → `UNMATCHED` (`releaseId` cleared)
6. **Re-sync** (`--overwrite`) → re-evaluates, lands on any of the above

`UNKNOWN` is the one status a plain `./sync` re-evaluates despite the release already holding a
`releaseId`. The per-release skip is `releaseId.is_some() && status != UNKNOWN`, so step 4's reset
actually reaches a recalculation on the next ordinary run - it used to be inert, leaving a status
computed against a tracklist that no longer existed until someone thought to pass `--overwrite`.

## Rate Limiting

Shared with `index` via `common::mb::api::RateLimiter`. Floor 1100ms (`MB_MIN_DELAY_MS` overrides, clamped 1100–10000), cap 10s. A rate limit doubles the delay; each success sheds a flat 100ms back toward the floor.

**The limiter is a token schedule, not a lock.** `wait()` claims the next issue slot from one monotonic schedule and pushes it forward by a full delay, so *however many* callers are running, requests leave at one per 1100ms. Cloning a `RateLimiter` yields another handle onto the **same** schedule — MusicBrainz's budget is per-application, so a concurrent run must never hand a worker a limiter of its own. `MB_MAX_INFLIGHT` (default 8, clamped 1–16) bounds outstanding requests; it changes nothing about the rate.

**Why concurrency at all.** MusicBrainz is latency-bound for this workload, not rate-bound. Measured live: a cold `inc=recordings` browse averages ~10s (max 29.8s) and `artist?inc=url-rels+genres+tags` ~10s, while the same query warm returns in 0.2s. A strictly serial client therefore reaches only `1/latency` ≈ 0.15 req/s of its ~0.91 req/s allowance and leaves the wire idle the rest of the time. `--concurrency` overlaps the *waiting*, not the requests. At ~10s latency the schedule saturates around 9 in flight; beyond that the slot spacing binds and more workers buy nothing.

**Header caution.** `X-RateLimit-Remaining` is a **shared global pool**, not this client's budget — measured at `limit: 1200` over a one-second window, drifting 886 → 619 → 511 → 472 while this client spent three requests. Nothing derived from it may return a delay below the floor; the low-budget branch backs off toward the cap instead. (It used to return 500ms — twice MusicBrainz's published rate, precisely when the server was busiest.)

503 is classified **rate-limit** vs **server overload** from its body and headers, and only the former slows the steady-state pace — MusicBrainz being unwell is not fixed by going slower. The penalty applies at most once per request, not once per retry. A load-shed 503 may reuse the slot it already paid for rather than buying a new one, but **only while nothing else is queued**: under concurrency the wire is busy by definition, and letting retries jump the queue there is how "retry cheaply" turns into exceeding the rate. Retries up to 6x on 429/503 with a 1s → 16s ladder, or `Retry-After` when MusicBrainz sends it. **Transport-level failures (read timeout, connection reset, DNS) go on the same ladder** — they used to bail out of `mb_get` immediately with no retry at all, and the caller then abandoned the whole artist on a single blip. Rare while requests went out one at a time; not rare once they overlap, since a cold browse measured at 29.8s against the old 30s client timeout. The client timeout is now 60s. Full detail in `docs/scripts/index.md` § Pacing.

### Browse pagination

MusicBrainz caps an `inc=recordings` browse by **response size, not `limit`** — `OK Computer` reports `release-count: 39` and serves 31 for `limit=100`. Every browse loop therefore advances by the rows actually returned and stops on the reported count, never on a short page. Stopping on a short page silently dropped the tail: for `OK Computer` that was all 8 `OKNOTOK 1997 2017` editions, i.e. exactly what the deluxe-upgrade path goes looking for.

## Release Deduplication

Index creates one `LocalRelease` per folder. Multiple folder-copies of the same album are separate `LocalRelease` rows; sync binds each to the same `MusicBrainzRelease` via `releaseId` (no guard blocks the duplicates). The web UI groups by MB release, collapsing the copies into one card, and the `duplicate-release` audit rule lists them for review.

A compilation is one `LocalRelease` linked to many artists through the many-to-many `LocalReleaseArtist` table (one main-artist link per distinct `albumArtist` tag), bound to one `MusicBrainzRelease` — shared, not duplicated per artist.

## Multi-Edition Handling

Multiple editions (original, remaster, deluxe) stored as separate `MusicBrainzRelease` rows sharing a `releaseGroupId`. Each has its own `musicbrainzId` and `disambiguation` label. Cover art fetched per-release first, falling back to release-group art.

## Audio-only track counting

A release's `media[]` can include a non-audio bonus disc (Blu-ray, DVD) alongside its CD/vinyl/digital
medium. `common::mb::api::flatten_audio_tracks` — the single point both `mb_get_release_tracks` and
`mb_get_release_by_id` flatten through — drops any medium `common::mb::allowlist::is_audio_medium`
denies (Blu-ray, DVD, VHS, and similar video carriers) before building the track list everything else
consumes: `check_release_status`'s track counts and sibling tiebreak, the inserted
`MusicBrainzReleaseTrack` rows, and therefore the web track list and card `trackCount`.

`is_audio_medium` is a **deny-list**: an unrecognized or missing `format` defaults to audio, because
over-counting (today's failure mode without this) is recoverable on the next sync while an allow-list's
failure mode — silently dropping a real audio medium on an unlisted format — would delete real tracks.
It keys on MusicBrainz's medium **format**, not the per-recording `video` boolean, which MusicBrainz
reports `false` even on a Blu-ray-only medium. The one incident this fixed: 04 Limited Sazabys' "MOON"
EP (release `a3b9c410…`) is a CD (4 audio tracks) + Blu-ray (1 video track) edition; a perfect 4/4 audio
rip was scored `MISSING_TRACKS` against an inflated 5-track expectation and discarded on every merge.

The composed `format` column (`format_from_media`, e.g. `"Blu-ray, CD"`) is unaffected — it reads
`media[].format` directly and stays display metadata, not a completeness input.

## Box Sets

Full design and rollout plan in `docs/sync_decisions.md` (that file is the sole spec - this is a summary).
MusicBrainz has no box-set entity - a box is one Release with N media, and MB stores no id-level link
from a box's disc to the standalone album it duplicates. `MusicBrainzReleaseMedium` (one row per medium:
`position`, `title`, `format`, `trackCount`) and `MusicBrainzReleaseTrack.recordingId` (the MB
*recording* id, not the release-scoped `musicbrainzId`) make both facts queryable on our side.

`index` never folds a multi-medium release - `./tidy` decides everything (binding, medium assignment,
fold-vs-dissolve, equivalence), scoped by whatever artist ids that tidy run was given
(`dmp_sync::boxset::run_repair`, `scripts/sync/src/boxset.rs`, called from `scripts/tidy/src/main.rs`).
Moved out of sync's own tail - see `docs/scripts/tidy.md`.

- **Binding**: tags agreeing with MB bind a folder to its release + medium position for free; when they
  don't (every disc tagged `discNumber=1`), `boxset::plan_box_bind`'s tracklist matcher (title + duration
  ±5s, the `find_owning_bundle` rule) decides, accepting only a perfect matching.
- **Equivalence** (`sync::box_editions`, three tiers, each only running on what the previous left
  unlinked): tier 1 exact recording-set equi-join (`recordingFingerprint`, no track-count floor - exact
  ID equality has zero coincidence risk); tier 2 artist-scoped title+duration positional fallback for
  releases synced before `recordingId` existed; tier 3 containment match (`owned::find_owning_bundle`)
  for a box medium using a bonus-track edition MB never catalogued as its own standalone release.
  Written onto `MusicBrainzReleaseMedium.equivalentReleaseId`/`equivalentReleaseGroupId`.
- **Fold vs dissolve**: `mediumCount > 1` with ≥2 media having an equivalent dissolves (each disc binds
  independently to the standalone album it reprints, or to the box itself as a rarities/no-equivalent
  disc); 0-1 equivalent folds (sibling `LocalRelease` rows merge into one, `LocalReleaseMember` per
  absorbed folder). No majority clause - flat `≥2` at every box size.
- **Web**: a dissolved disc is a real bound `LocalRelease` that flows through `buildReleaseCard`
  (`web/server/utils/releaseAggregation.ts`) and lands in its album's edition group via the existing
  `releaseGroupId` grouper, with no box-specific logic. `UnifiedRelease.boxParent` carries its
  provenance (which box, which renumbered disc position); a rarities/no-equivalent disc gets its own
  row (`"{box title} — {medium title}"`) with a `Box Set` marker pill (`info`/violet tone, same as the
  fold-only `DiscsPill`). See `docs/sync_decisions.md` §7-8 for the full web contract.

## End-of-run cleanup

Moved to `./tidy` (`dmp_sync::db::delete_empty_local_releases`/`delete_orphaned_mb_releases`, both take
an `ArtistScope`) - sync's own tail no longer runs it. Only the `--catalogue-gaps` path still does its
own scoped orphan sweep + retire inline, since it's a per-artist fast pass that stays in `sync`. That
inline tail is `catalogue_gaps::finish_run(pool, scope, reporter)` — shared with `./add`, which calls
it after its own `fill_catalogue_gaps`, so the ordering rule below lives in exactly one place rather
than being copy-pasted per caller.

`delete_orphaned_mb_releases` spares a release that local tracks still point at via
`LocalReleaseTrack.mbTrackId` while no `LocalRelease.releaseId` does — the shape a dissolved box leaves
behind (docs/sync_decisions.md §5); `LocalRelease.releaseId` alone doesn't see that link.

`retire_owned_missing_placeholders` stays global, but is **not** self-contained: it only pins a
placeholder while a `DownloadedRelease` targeting it is in a *live* state
(`DOWNLOADING`/`ENRICHING`/`READY`/`PROMOTED`), so a merge that discards its download (`web/server/
utils/promote.ts`'s `stampMerged`) no longer blocks the placeholder from being retired once its
now-orphaned MB release is gone. That ordering is load-bearing: `delete_orphaned_mb_releases` must run
**before** `retire_owned_missing_placeholders` at every call site (`./tidy` runs the pair twice - once
before the box pass, once after - and the `--catalogue-gaps` path here in `sync` does too), or the
orphan is still standing as a non-MISSING sibling and retire deletes the placeholder instead — the
wrong survivor, since the placeholder is what makes the release re-downloadable. `stampMerged`'s own
discard branch deletes the orphan synchronously instead of waiting for the next sync, so this ordering
mostly guards the case where an older bad row already exists.

## Locking & Resumability

Named DB lock (`"sync"`). Clears stale locks older than 10 min. SIGTERM/Ctrl-C handlers release the lock; second Ctrl-C force-exits.

Run hash stored in `Settings.syncRunHash`. On restart, artists already processed (matching `Artist.syncHash`) are skipped. Hash cleared on completion. `--overwrite` generates a new hash. `--release` bypasses hash.

## Running on NAS

```bash
sudo docker exec dmp sync --from=e --to=fz
```
