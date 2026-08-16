# Scripts: sync

Queries pending artists (`lastIndexedAt > lastSyncedAt`) and syncs each against MusicBrainz. Uses a run hash for resumability - interrupted runs skip already-processed artists. Reads from DB and calls MB API. Writes found MB IDs back to audio file tags (preserving mtime to avoid re-index) and embeds downloaded cover art.

Artists that only hold track credits ("appears on", owning no release here) are deliberately not synced -
they are excluded by `EXISTS(LocalReleaseArtist)` rather than by a stored flag. See
`docs/scripts/index.md`'s Artist Resolution section.

## TL;DR

1. Load config, connect DB, acquire process lock (prevents concurrent runs)
2. Select artists: `--release` (single), `--overwrite` (all), or default (pending where `lastIndexedAt > lastSyncedAt`). Skip artists already processed in current run (matching `syncHash`)
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
   - **Allow-list**: bind only Official Album/EP release-groups (rejects Broadcast/Other, non-Official/bootleg, and non-music secondary types). A Single-typed group binds only when the *files' own* MB ids point at it; a rejected candidate gets one search-tier retry before going Unmatched
   - Compare local vs MB track counts → status: COMPLETE / EXTRA_TRACKS / MISSING_TRACKS / INCOMPLETE
   - If ambiguous (multiple editions, no exact track-count match) → UNMATCHED
   - Upsert MB release, link tracks, update local release match status
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
./sync --recompute-scores        # Recompute every artist's averageMatchScore (pure SQL), then exit
./sync --repair-shared-release-ids [--dry-run]  # One-off repair of releases that lost a shared-releaseId conflict
```

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
| `--web` | bool | false | Emit PROGRESS:{json} for web terminal |
| `--artist-ids` | String | - | Read artist IDs from file (one per line, used by refresh) |
| `--artist-hint` | String | - | With `--release`: prefer this Artist ID when the release has several main artists |
| `--recompute-scores` | bool | false | Recompute `averageMatchScore` for all artists from the catalogue (pure SQL, no API), then exit |
| `--repair-shared-release-ids` | bool | false | One-off: unbind LocalReleases that lost a shared-`releaseId` conflict (pure SQL), then exit |
| `--dry-run` | bool | false | With `--repair-shared-release-ids`: print the plan, write nothing |

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
7. **Write MB IDs** back to audio file tags (`MUSICBRAINZ_ALBUMARTISTID`, `MUSICBRAINZ_ALBUMID`, `MUSICBRAINZ_RELEASEGROUPID`, `MUSICBRAINZ_TRACKID`) - only fills tags that are absent; never overwrites an existing value unless `--overwrite` is passed (deliberate re-correction, e.g. after fixing a bad match). Preserves file mtime to avoid triggering re-index. Skipped with `--skip-mb-tags`. A file with no tag block at all gets one created so IDs can still be written.
8. **Cover art** - download from Cover Art Archive (release-level first, release-group fallback), embed into audio file tags, then re-extract 200x200 thumbnails via same pipeline as index (`common/src/images.rs`)
9. **Set `lastSyncedAt`** on Artist, persist country code, compute average match score
10. **Stamp run hash** on Artist for resumability

Duplicate detection: tracks processed MB IDs across the run. Skips artists that resolve to an already-processed MB artist.

## --catalogue-gaps Behaviour

Fast path for populating MISSING MusicBrainzRelease entries without re-running the full sync. Requires artists to already have `musicbrainzId` in DB (from a previous full sync).

**Per artist (a few API calls):**
1. Use existing `musicbrainzId` from DB (no search/lookup)
2. Fetch release groups from MB API
3. Fetch the artist's Official Album/EP releases (paginated, ~1–4 calls) to learn which groups have an Official release — see "Official-only gaps"
4. Query existing artist genres from DB (no API call)
5. If `--overwrite`, delete stale MISSING entries first; otherwise skip release groups that already have MISSING entries
6. Create MISSING entries for uncovered, official Album/EP release groups + link genres

**Skips entirely:** artist search, artist detail fetch, URL upsert, artist image, local release matching, cover art download.

**Skip logic:** Without `--overwrite`, existing MISSING releases are preserved and only new gaps are added. With `--overwrite`, all MISSING releases are deleted and re-created from scratch.

**Performance:** ~2–5s per artist (rate limit; 1 release-group browse + 1–4 official-release pages). 500 artists ≈ 20–40 minutes vs ~7 days for full sync.

Cannot combine with `--release` or `--delete`. Compatible with `--from`/`--to`/`--only`/`--exact`/`--overwrite`/`--web`/`--verbose`.

## --only-write-mb-to-files Behaviour

Writes DB-known MB IDs back into audio file tags. No API calls - reads entirely from DB. Only fills in **absent** tags; never overwrites existing file values. Preserves file mtime to avoid triggering re-index.

**Per artist:** queries all matched tracks (joined through LocalRelease → MusicBrainzRelease → MusicBrainzReleaseTrack), writes missing `MUSICBRAINZ_ALBUMARTISTID`, `MUSICBRAINZ_ALBUMID`, `MUSICBRAINZ_RELEASEGROUPID`, and `MUSICBRAINZ_TRACKID` tags.

**Use case:** backfill tags after a full sync so files become source of truth. Run once after initial sync to persist all found MB IDs into files.

Cannot combine with `--release`, `--delete`, or `--catalogue-gaps`. Compatible with `--from`/`--to`/`--only`/`--exact`.

## --delete Behaviour

Resets `musicbrainzId`, `averageMatchScore`, and `lastSyncedAt` to NULL, unlinks `MusicBrainzRelease` records, resets `LocalRelease.matchStatus` to `UNMATCHED`. Re-running `./sync` after this automatically re-syncs those artists.

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

### Already owned inside another release (`scripts/sync/src/owned.rs`)

Coverage is computed from binds, and a `LocalRelease` can only point at one MB release — so a **bonus
disc has no bind of its own**. `Radiohead/EP/2009 - In Rainbows Disk 2` physically holds CD 01 + CD 02
(18 tracks, tagged `album = In Rainbows`, no MB ids), binds to the *In Rainbows* group, and leaves
MusicBrainz's separate `In Rainbows Disk 2` group looking uncovered → MISSING gap → the trickle worker
downloaded 8 tracks that were already on disc 2.

Before writing a gap, `claim_owned_bundle` asks a stricter question: **is every track of this release
already inside one local release?** A claim requires all of:

- every MB track matched to a **distinct** local track by normalized title (case/punctuation-insensitive);
- durations within **±5s** where both are known — `In Rainbows: From the Basement` is the same ten
  songs played live and passed a title-only rule; its takes run 1–33s off the studio ones, and since
  every track must match, one honest outlier refuses the claim;
- the local release is a **strict superset** (an exact-size match belongs to the matcher, which binds it);
- at least 3 MB tracks (a one- or two-track "release" matches by coincidence inside any album).

On a claim: the real release + its tracks are written, the local tracks are linked to them
(`LocalReleaseTrack.mbTrackId` — so `sync --only-write-mb-to-files` puts the ids in the files), the
release is stored `COMPLETE` with `statusReason = 'Owned as part of "<folder>"'`, dead queue rows for
the group are rejected, and **no gap is created**. Release-level ids are deliberately *not* written to
those files: making 8 tracks the majority `MUSICBRAINZ_ALBUMID` of an 18-track folder would rebind the
whole folder to the bonus disc, and `In Rainbows` itself would then look missing.

`get_covered_release_group_ids` counts a group as owned when every one of its MB tracks is linked to a
local track, so a claim survives — the check costs one MB call per group, once, and never repeats.
The web side finishes the job: `rejectOwnedElsewhereDownloads` (monitor tick, 60s) rejects any staged
READY download whose release carries that reason, purging its files through the normal reject path.

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

Shared with `index` via `common::mb::api::RateLimiter` — one limiter per process, threaded as `&mut`, so MB calls are sequential by construction. Floor 1100ms (`MB_MIN_DELAY_MS` overrides, clamped 1100–10000), cap 10s, adjusted via `X-RateLimit-Remaining` / `X-RateLimit-Reset`. A rate limit doubles the delay; each success sheds a flat 100ms back toward the floor.

503 is classified **rate-limit** vs **server overload** from its body and headers, and only the former slows the steady-state pace — MusicBrainz being unwell is not fixed by going slower. The penalty applies at most once per request, not once per retry. Retries up to 6x on 429/503 with a 1s → 16s ladder, or `Retry-After` when MusicBrainz sends it. Full detail in `docs/scripts/index.md` § Pacing.

## Release Deduplication

Index creates one `LocalRelease` per folder. Multiple folder-copies of the same album are separate `LocalRelease` rows; sync binds each to the same `MusicBrainzRelease` via `releaseId` (no guard blocks the duplicates). The web UI groups by MB release, collapsing the copies into one card, and the `duplicate-release` audit rule lists them for review.

A compilation is one `LocalRelease` linked to many artists through the many-to-many `LocalReleaseArtist` table (one main-artist link per distinct `albumArtist` tag), bound to one `MusicBrainzRelease` — shared, not duplicated per artist.

## Multi-Edition Handling

Multiple editions (original, remaster, deluxe) stored as separate `MusicBrainzRelease` rows sharing a `releaseGroupId`. Each has its own `musicbrainzId` and `disambiguation` label. Cover art fetched per-release first, falling back to release-group art.

## End-of-run cleanup (scoped)

`delete_empty_local_releases` and `delete_orphaned_mb_releases` take an `ArtistScope`. A narrowed run
(`--only`, `--from`/`--to`, `--release`, `--artist-ids`) passes the artists it actually synced; the default
"pending" sweep and `--overwrite` pass `None` and garbage-collect globally, because they saw everything.

This is not a micro-optimisation. Unscoped, the MB variant deletes every non-MISSING `MusicBrainzRelease`
in the library that is unbound at that instant — so `./sync --only "One Artist"` could take out a perfectly
real release whose `LocalRelease` index had just regrouped, for an artist the run never touched.
`retire_owned_missing_placeholders` stays global: its predicate is fully self-contained.

## Locking & Resumability

Named DB lock (`"sync"`). Clears stale locks older than 10 min. SIGTERM/Ctrl-C handlers release the lock; second Ctrl-C force-exits.

Run hash stored in `Settings.syncRunHash`. On restart, artists already processed (matching `Artist.syncHash`) are skipped. Hash cleared on completion. `--overwrite` generates a new hash. `--release` bypasses hash.

## Running on NAS

```bash
sudo docker exec dmp sync --from=e --to=fz
```
