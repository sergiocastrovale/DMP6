# Scripts: index

Walks MUSIC_DIR, extracts metadata, upserts the local DB tree. Sets `lastIndexedAt` only when data actually changes. Run-hash resumable.

## Build

```bash
cd scripts && cargo build --release -p index
```

## Usage

```bash
./index                          # index all
./index --only "radiohead"       # prefix match
./index --only "radiohead;bjork" # multiple, ;-separated
./index --only "Air" --exact     # exact (won't catch "Airbag")
./index --from "A" --to "M"      # letter range
./index --overwrite              # force re-index, keeps existing covers
./index --overwrite-with-images  # force re-index + re-extract all covers
./index --inspect                # re-check existing files for metadata changes
./index --prune                  # delete rows for missing files, even past the 20% mount-blip guard
./index --resume                 # continue from last checkpoint
./index --release "clxxxxxxx"    # re-index one release by LocalRelease id
./index --folders "Artist/Album" # exact folder paths, ;-separated
./index --skip-covers
./index --threads 4              # rayon thread count, default 8
./index --music-dir /path        # override MUSIC_DIR env
./index --web                    # PROGRESS:{json} for web terminal
./index --resolve-artists [--dry-run] [--only "Name"] [--overwrite]  # resolve artist tags only, no folder scan
./index --skip-resolve           # skip end-of-run resolution pass
./index --canonicalize-artists [--dry-run]  # reconcile Artist rows vs MB, no network, no folder scan
```

`--release` can't combine with `--from`/`--to`/`--only`/`--folders`.

## CLI Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--from` / `-f` | String | - | Start letter filter |
| `--to` / `-t` | String | - | End letter filter |
| `--only` / `-o` | String | - | `;`-separated artist folder prefixes |
| `--exact` | bool | false | Exact match for `--only` |
| `--folders` | String | - | Exact relative folder paths |
| `--release` | String | - | Re-index one release by LocalRelease id |
| `--overwrite` | bool | false | Re-index ignoring change detection, keeps covers |
| `--overwrite-with-images` | bool | false | Like `--overwrite`, also re-extracts all cover art |
| `--inspect` | bool | false | Re-check existing files for changes (size/mtime/hash) |
| `--prune` | bool | false | Delete rows for missing files even past the 20% mount-blip guard (only folders this run walked and found audio in) |
| `--skip-covers` | bool | false | Skip cover art extraction |
| `--resume` | bool | false | Resume from last checkpoint |
| `--threads` | usize | 8 | Rayon thread count |
| `--music-dir` | String | - | Override MUSIC_DIR env |
| `--web` | bool | false | PROGRESS:{json} for web terminal |
| `--emit-artist-ids` | String | - | Write processed artist ids to file (used by refresh) |
| `--resolve-artists` | bool | false | Resolve artist tags vs MB + rebuild links, exit (no folder scan). Honors `--only`/`--from`/`--to`/`--exact`/`--folders`/`--release` for scope, `--overwrite` to ignore the lookup cache |
| `--dry-run` | bool | false | With `--resolve-artists`/`--canonicalize-artists`: print decisions, write nothing |
| `--skip-resolve` | bool | false | Skip end-of-run resolution pass |
| `--canonicalize-artists` | bool | false | Reconcile `Artist` rows vs `MbArtistLookup` (clear contradicted ids, rename to canonical, connect duplicates, sweep orphans), exit. Pure SQL, seconds, no network/scan. Same scope filters as `--resolve-artists`; scoped run makes only slug-stable renames |

## Output Modes

Without `--web`: colored console progress. With `--web`: `PROGRESS:{json}` lines + plain text panel (web UI appends `--web` automatically).

## Per-Folder Flow

1. **Walk** for audio files (mp3/flac/aac/opus/m4a/ogg) via jwalk.
2. **Extract** metadata in parallel (rayon+lofty), incl. MB tags (`MUSICBRAINZ_ALBUMID`/`RELEASEGROUPID`/`ALBUMARTISTID`/`ARTISTID`) — keys matched on alphanumeric-only normalization since the same key arrives as `MUSICBRAINZ_ALBUMID` (Vorbis), `MusicBrainz Album Id` (TXXX), or `MusicBrainzReleaseId` (lofty's name) depending on container.
3. **Pre-scan** — propagate MB release/release-group ids across tracks sharing album/year/albumArtist.
4. **Change detection** — default: skip if `filePath` in DB. `--inspect`: compare size/mtime/hash. `--overwrite`: skip detection, keep covers. `--overwrite-with-images`: skip everything, re-extract covers.
5. **Store** raw `artist`/`albumArtist` tags + multi-value `Artists[]`/`MusicBrainzArtistId[]` on the track. No identity decided here — post-loop resolve pass (below).
6. **Upsert** Artist (album artist only, this stage), LocalRelease, LocalReleaseTrack, LocalReleaseArtist (batch UNNEST).
7. **Cover art** — extract from embedded tags/folder images, content-addressed by MD5 (same bytes = one file, shared across releases).
8. **Delete** tracks gone from disk. Guarded: >20% of DB rows under the prefix missing → assumes unmounted share, deletes nothing. `--prune` bypasses the guard for folders this run walked and found audio in (mount provably up) — the only way a wholesale folder swap (old rip removed, new one dropped in, ~half rows "missing") ever loses its stale rows. Library-wide `detect_deleted_folders` sweep keeps the guard unconditionally. Favorites/playlist entries pointing at deleted tracks cascade away (a renamed file is a new track row, `filePath` is identity) — counted, reported once as `WARN: dropped N favourite(s) and M playlist entry(ies) for removed files` (web UI: amber notice via `dropped_links_line`/`parseDroppedLinks`). Nothing re-linked automatically. Every affected release resets to `matchStatus=UNKNOWN` for sync recompute.
9. **Update totals** for the artist's releases/tracks.
10. **Set `lastIndexedAt`** (only if folder had new/updated/deleted tracks).
11. **Stamp run hash** on FolderScan.
12. **Upsert FolderScan** (folder mtime).

Post-loop: detect entirely deleted folders (unfiltered runs only), resolve artist identity + rebuild owner/credit links (`--skip-resolve` skips this — see Artist Resolution), safety-net re-extract of missing release images.

## Locking & Resumability

Named DB lock (`"index"`). Clears stale locks >3min. SIGTERM/Ctrl-C release the lock, 2nd Ctrl-C force-exits - an interrupted run keeps its checkpoint and run hash instead of clearing them, so `--resume` picks up where it stopped. Per-folder checkpoint for `--resume`; every folder on disk counts as scanned for the deleted-folder sweep, not just the ones this particular resumed run walked, or a checkpoint-skipped head reads as deleted.

Run hash in `Settings.indexRunHash`. Restart skips already-processed folders (`FolderScan` hash match). Cleared on completion. `--overwrite` generates a new hash. `--release`/`--folders` bypass it.

## Release Grouping

**One folder = one `LocalRelease`.** `build_group_key` keys on the containing folder alone: `"folder:{folderPath}"` (root-level loose files fall back to `"meta:{slugTitle}:{year}:{slugArtist}"`). Folder name is never parsed for metadata — title/year/artist come from tags, then the MB match.

Per-track MB ids are **not** part of the group key — they identify which release a *recording* appears on, not which folder-album a *file* belongs to (keying on them would shred compilations into per-track fragments). Still stored per-track for sync's matcher.

Display title/year = the folder's **unanimous** `album`/`year` tag (`common::consensus::evaluate`, `docs/no_guessing.md`) — not a majority/mode. Tracks disagreeing on `album` (or an embedded MB id) parks the release `UNKNOWN` with a human-readable `statusReason` and a folder-leaf display title instead of a guessed one; sync overrides with the MB title once matched.

`folderPath` scoping means the same album ripped into two folders = two `LocalRelease` rows (genuine duplicate copies) — sync binds both to the same `MusicBrainzRelease`; web UI collapses to one card; `duplicate-release` audit rule surfaces them.

**Compilations link many artists to one release.** One `LocalReleaseArtist` link per distinct `albumArtist` tag in the folder. `"Various Artists"` → one link; a per-source-tagged comp → N links to the *same* release (shared via many-to-many, not duplicated), appearing on each of those N artists' pages.

### Multi-disc folders and box sets

Index never folds sibling disc folders on its own — needs MB medium data only `sync` has (`docs/sync_decisions.md` §3-4). `sync`'s `boxset::run_repair` decides fold vs dissolve at the tail of every run, writes a `LocalReleaseMember` row per folded/dissolved disc.

**`get_local_release_members` runs before `build_group_key`.** A folder sync already folded/dissolved routes straight to its existing `LocalRelease` id, title/year untouched — without this, a box whose discs all read `discNumber=1` in their own tags would split straight back apart on the next `--overwrite`/`--prune` re-index (a plain index has no other way to know the fold happened).

## Cover Art Deduplication

Content-addressed: filename = MD5 hash of the image (`{hash}.jpg`) — a 90-disc box set extracts one cover, not 90.

- **MB ID shortcut**: releases sharing `mb_release_id`/`mb_release_group_id` with an already-processed release skip extraction, reuse the known hash.
- **Content hash**: after extraction, `{hash}.jpg` already on disk → duplicate discarded.

Works with all storage modes (`local`/`s3`/`both`). S3 uploads once per unique hash. Reference-counted on delete — removed only when no `LocalRelease` points to it.

## Artist Resolution (MusicBrainz-validated)

**A separator is never, by itself, evidence of a split.** Real bands: "Nurse With Wound", "MAN WITH A MISSION", "Mumford & Sons", "Earth, Wind & Fire". Measured: old punctuation-guessing splitter split **721/722** distinct `" with "` values, including 4 real bands owning releases here. A hardcoded exception list can't fix an unbounded problem.

So sync asks MB: *is this whole string an artist?* Only a definitive "no" justifies looking for a split, and every candidate grouping is validated the same way (`common::mb::resolve`).

### Two phases

**Phase A** (network): walks distinct tag values alphabetically, asks MB about each. Produces the memo + `MbArtistLookup` rows. **Phase B** (offline): walks tracks, writes owner/credit links — every name memoized by then, no network calls. **Phase C** tail (offline): `canonicalize_artists` (below) reconciles `Artist` rows with what MB said, `delete_orphan_artists` sweeps whatever's left unlinked.

The A/B split means: progress is alphabetical + honest (old track-driven loop's counter stalled/repeated on deferrals); a crash is cheap (`MbArtistLookup` *is* the resume state, `--overwrite` skips the cache warm to force a re-ask); run cost visible upfront (`Resolving N of M (M-N already resolved)`).

**The cache warm loads the whole table, not just the tag values being resolved.** Tier 3 takes a compound apart and asks about the *atoms* inside — an atom usually isn't itself a distinct tag value, so warming by name only left every atom a memo miss. Measured: a 3-minute run made 57 lookups, inserted **zero** new rows (all re-asked known names). Warming the whole ~44k-row table (a few MB, folder scan already loads it) cut the pending set from 44,544 to 34,874 names in one step.

### Search order

| Tier | Source | Cost |
|---|---|---|
| 0 | Embedded tags: `Artists[i]` paired with `MusicBrainzArtistId[i]` | free |
| 1 | `MbArtistLookup` cache (hits + misses, 30-day negative TTL) | free |
| 2 | MB search for the **whole string** — hit = one artist, no split | 1 request |
| 3 | Memoized contiguous-span recursion over separator positions, coarsest grouping wins | O(n²) requests |
| 4 | Fallback: atoms are the artists, unverified | free |

Tier 0 carries most of the library — Picard writes one `Artists` value + one `MusicBrainzArtistId` per credited artist, split already done and authoritative when they line up (multi-value frames, `metadata.rs` collects every value).

A **single** pair counts too, only when that one value *is* the whole tag (makes "Kool & the Gang" safe with no network call). Not theoretical: of 3,308 single-pair tracks measured, 3,307 matched, 1 didn't (tag "The B.B. King Blues Band", embedded value "B.B. King" — would've replaced the band with the person). Mismatch falls through to lookup.

Tier 3 is a **span** search: `resolve_span(i,j)` asks about a contiguous run of atoms, recurses on misses, memoized per span — O(n²) not O(2ⁿ), prefers the coarsest valid grouping ("Y & Z with A" → "Y & Z" + "A" when MB knows the duo). Above 8 separators (~0.1% of names) only the whole string + atoms are tried.

A transient failure (timeout/503) → **deferred**, name left alone, retried next run — only a definitive MB "no match" triggers a split. Deferred answers are never cached (genuinely re-asked, not pinned).

### Separators

Word: ` featuring `, ` feat. `, ` ft. `, ` with ` (guest); ` vs `, ` and `, ` & `, ` x `, `; `, `, ` (co-billing). Typographic: ` / `, ` + `, ` · `, ` • `, ` ♦ `, ` \ `, `\\`, `\`, `|`.

- **Spaces required** on `/` and `+` — bare "AC/DC" and "Akio Suzuki/Takehisa Kosugi/Riri Shimada" are the same shape; only the first is protected by a tier-2 hit, so both stay whole.
- **`\\` listed before `\`** — ID3v2.3 has no multi-value frame, taggers join with doubled backslash. Matched byte-at-a-time, the first `\` used to be the separator and the second rode along ("Mal Waldron\\Jim Pepper" → artist `\Jim Pepper`, which then *passed* MB verification because `normalize_name` strips punctuation).
- **Dangling markers trimmed, not split** — `trim_separator_noise` strips leading/trailing separator punctuation before lookup (tier 2 runs before any split, would otherwise cache the decorated spelling). Guarded on the result still holding a letter/digit, so "+/-"/"!!!" survive.

### Pacing

`RateLimiter` floor 1100ms (`MB_MIN_DELAY_MS`, clamped 1100-10000), adaptive: rate-limit doubles delay to 10s cap, success sheds 100ms back toward floor.

503 classified **rate-limit** vs **server overload** by body + `X-RateLimit-Remaining` — only the former slows steady-state. Penalty applies once per request, not per retry (used to walk 1100→10000 over 5 retries of one unlucky name, pinning every later name at the cap). `Retry-After` wins over local backoff when sent.

**Most 503s here are not us.** Measured live: body `"The MusicBrainz web server is currently busy..."`, `x-ratelimit-remaining:14/15`, `retry-after:0` — using 1/15 of the allowance, server just load-shedding. Raising the floor to 1300ms was tried, cost throughput, fixed nothing, reverted. Overload 503 handled as what it is: served no data, retry doesn't re-pay the inter-request delay (250ms floor stops a hot loop), not logged (~1/3 of requests on a long run take this path, recover on first retry — logging each made a healthy run look broken). Total reported once: `Absorbed N transient MusicBrainz 503(s)`. Only `deferred` counts real failures.

**Offline backstop:** `KNOWN_SINGLE_ARTISTS` (`common/src/artists.rs`) consulted before any split — a known-single band stays whole even on MB "no such artist" (rename/alias/bad response). MB still asked for the id, only the split is suppressed. Matches on normalized name (one entry covers every punctuation spelling). A floor, not authority.

| Tag | Split? | Survives because |
|---|---|---|
| `AC/DC` | none — bare `/` not a separator | structurally unsplittable |
| `Florence + The Machine` | none — `+` not a separator | structurally unsplittable |
| `Kool & The Gang` | yes (` & `) | embedded single pair, MB hit, **and** backstop |
| `Tom Petty and the Heartbreakers` | yes (` and `) | embedded single pair, MB hit, **and** backstop |

### Finding bad tags at source

`./problems` — read-only scan reporting each tag condition that breaks/degrades this pipeline, per file. `docs/scripts/problems.md`.

### Candidate separators

`,` `;` `/` `\` `|` ` & ` ` and ` ` vs ` ` x ` `feat.` `ft.` `featuring` ` with `. Only *propose* split points — MB decides. A comma between digits ("10,000 Maniacs") is never a separator.

### Owner vs credit

Mirrors MB artist credits / Spotify discography vs `appears_on`:
- **Owner** → `LocalReleaseArtist`. In `/browse`, counted in stats, synced to MB.
- **Credit** → `TrackRelatedArtist`. Own page, searchable, shows under appearances — excluded from browse/stats/sync.

**Join phrase decides which:**
- Guest (` with `, `feat.`, `ft.`, `featuring`) → first part **owns**, rest **credited**. "Frank Sinatra with Count Basie" → Sinatra owns, Basie credited.
- Co-billing (` & `, `,`, `;`, `/`, ` and `, `vs`) → all parts **co-own**. "B.B. King & Eric Clapton" → both own.

An Artist row for a credit is created **only when MB verified the name** — unverified tier-4 atoms never become browsable artists. Dangling role fragments ("His Orchestra", "special guests") dropped.

`albumArtist` goes through the same resolver, not taken verbatim — splits compounds like "Frank Sinatra with Billy May & His Orchestra" but only into MB-confirmed artists.

**Ownership is derived, never stored** — no `relatedOnly` flag, "owns something" = `EXISTS(LocalReleaseArtist)` (a cached boolean once silently read 0 for 2.5 months).

`delete_orphan_artists` must check **all 3** link tables (`LocalReleaseArtist`, `MusicBrainzReleaseArtist`, `TrackRelatedArtist`) — omitting the third deletes every credit artist the resolver just created.

A `manuallyAdded` artist (`./add`) is excluded from orphan sweep too — added before any link exists, on purpose, must survive until catalogue-gaps or a real release gives it one.

### Cleanup is scoped to the run

`delete_empty_releases`/`delete_orphaned_mb_releases`/`delete_orphan_artists` take an `ArtistScope` — filtered runs (`--only`/`--folders`/`--from`/`--to`) scope to the touched artist set; only unfiltered sweeps the whole library (previously a filtered rescan was library-wide, garbage-collecting artists it never looked at).

Run **once, after the folder loop**, not per-folder (was 3 full-table anti-joins × ~25k folders for nothing read inside the loop). `detect_deleted_folders` stays unscoped, gated on `!has_filter`.

`--resolve-artists` (no folder loop) derives its own orphan scope: artists linked to in-scope releases, captured **before** the pass runs (unlinking is what the reconcile does — nothing left to join on afterward). Previously ran neither cleanup, 8,216 zero-link artists accumulated.

### When ownership is written

The folder loop can't wait for the resolve pass — `lastIndexedAt`, artist folder image, totals, `--emit-artist-ids` all key off the artist set the loop produces; an ownerless release is invisible in `/browse`, unsyncable, and (before the fix below) sweep-deletable.

So the loop resolves the **owner tag** offline first, free tiers only (embedded pairs, cache, backstop) — tier 4 rejected here (cold cache must never blind-split "Kool & The Gang"). Undecided → verbatim tag written as **provisional** owner, corrected later same run.

**The owner tag isn't always `albumArtist`** — on Various-Artists compilations the placeholder names nobody, so the track's own `artist` tag decides instead (contributors co-own). One definition, `index::resolve::owner_tag`, used by both loop and reconcile (used to drift — the loop had the VA fallback, reconcile read `albumArtist` alone, so VA releases' raw compound owner stuck forever; 497 had accumulated, e.g. a long session-musician list owning *The Bodyguard OST*).

Resolve pass runs an **ownership reconcile** replacing provisional owners, guarded to never make things worse. **Every artist the reconcile adds as owner is stamped `lastIndexedAt`** (via `RETURNING`, existing owners not re-queued) — used not to be: the loop stamps only owners *it* settled (the compound), so real substituted artists (often created on the spot) got no `lastIndexedAt`, and since sync only selects artists that have one, 5,445 owning artists were never synced, 437 albums never matched (fixed 2026-09-18, `docs/sync_decisions.md` §19 item 13).

| Guard | Why |
|---|---|
| Desired set = union across **all** distinct owner tags on the release | 11/435 measured releases carry >1; single-track overwrite would strip co-owners |
| Skip release if any owner tag **deferred** | never rewrite ownership on an incomplete picture mid-outage |
| Skip if desired set empty | keeps whatever the folder scan established |
| A track whose credit-producing resolution deferred is excluded from the `TrackRelatedArtist` diff entirely | same reasoning on the credit side - an incomplete picture must never read as "nothing credited," which is what wiped every guest credit under a cold resolver cache |
| `is_special_artist_name` parts never become owners | a tier-0 pairing can return the placeholder itself |
| `cap_co_owners` both sides | 44-session-musician tag is a personnel list, first owns rest credited — loop caps too or a warm cache writes 44 provisional owners |
| Insert new owners before deleting stale, one transaction | a release must never pass through zero owners |
| Delete only within the release scope | targeted runs stay targeted |

`delete_orphan_artists` runs after the reconcile, including in `--resolve-artists` mode (used to be skipped there, 8,216 zero-link rows piled up).

Warm cache → loop resolves correctly on the spot, no provisional owner written — 2nd `--only` run of an artist typically **0 MB lookups**. Cost paid once, cold cache.

### Artist folder image

Follows ownership, not folder name. **Primary** owner (first album artist resolved) always gets it; other resolved owners get it only if they have none yet. (Used to fire only for single-artist folders — a compound `albumArtist` handed its image to junk, and after splitting, those folders contributed no image at all.)

### Canonicalizing artist rows

An `Artist` row is created from a *tag string*, once — `ensure_artist` upserts `ON CONFLICT (slug) DO UPDATE`, whoever inserts a slug first owns its spelling forever, and `make_slug` strips punctuation (`"\Jim Pepper"` and `"Jim Pepper"` = same row, stuck decorated). `canonicalize_artists` reconciles with what MB said, from `MbArtistLookup` alone — no network, seconds:

1. **Clear contradicted MB ids** — row carries a `musicbrainzId` its own lookup row denies. Scoped to `lastSyncedAt IS NULL` (sync's ids aren't ours to overrule).
2. **Rename to canonical name** when `MbArtistLookup.mbName` differs. Free slug → rename both; slug unchanged (punctuation-only) → display fix, no URL churn. Taken name/slug → skipped (duplicate, step 3's job).
3. **Connect duplicates** via `primaryArtistId` (twin drops from `/browse`, catalogue aggregates to primary — most `LocalReleaseArtist` links, tie-broken by `createdAt`). Never a delete — folding is `./fix --duplicates`' job (genre/URL/playcount merge + undo trail).

Two load-bearing guards:

**`musicbrainzId` alone is not a safe merge key** — 3,115 ids shared by >1 row, almost all leaks ("Lena Horne & Gábor Szabó" carries Lena Horne's id with 0 links, lookup row says MB denied the string). Fix: both names need a lookup row resolving to the *same* id. 3,115 candidate groups → 172.

**Sharing an MB id still isn't enough** — `mb_artist_exact` matches MB **aliases** too (lookup legitimately reports "Simone"→Nina Simone, "ANT"→Adam Ant — MB saying the string *can* refer to that artist, not that it *is* their name; a library tag "Simone" means the Brazilian singer). Steps 2/3 additionally require both spellings to **normalize to the same key** (case/punctuation/leading "the"/`&` vs `and` folded). Variant pairs still merge ("Iron And Wine"/"Iron & Wine"); alias hits dropped. 172→108 connections, 1,343→1,295 renames.

**Scoped like every cleanup** — `./index --only "X"` must stay about X (the artist page's Scan button issues exactly that). Steps 1-2 filter on artist id; step 3 filters on **MBID** (a twin is usually out of scope, filtering it out would make every group look like a singleton). Measured: unfiltered `6474/1295/108`, `--only "Frank Sinatra" --exact` `1/5/4`.

A scoped run makes **only slug-stable renames** — punctuation-only fixes land, but a rename that moves the URL (e.g. "Ink Spots"→"The Ink Spots") waits for the library-wide pass, deliberately.

Runs at the end of every resolve pass (every UI scan button gets it free) and standalone as `--canonicalize-artists` (`--dry-run` prints without writing).

### Resolution order doesn't matter

Folders scan alphabetically — a guest may not exist yet when their host album is indexed. Resolve pass runs **after** the folder loop, re-derives from current DB — an artist indexed later still links correctly; a stale credit is removed rather than left dangling.

## Running on NAS

```bash
sudo docker exec dmp index --from=e --to=fz
```
