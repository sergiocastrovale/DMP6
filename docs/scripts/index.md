# Scripts: index

Walks MUSIC_DIR, extracts metadata from audio files, and upserts the local DB tree. Sets `lastIndexedAt` on artists only when data actually changes (new/updated/deleted tracks). Uses a run hash for resumability - interrupted runs continue from where they left off.

## Build

```bash
cd scripts && cargo build --release -p index
```

## Usage

```bash
./index                          # Index all artists
./index --only "radiohead"       # Only folders matching prefix
./index --only "radiohead;bjork" # Multiple artists (semicolon-separated)
./index --only "Air" --exact     # Exact match (won't catch "Airbag")
./index --from "A" --to "M"     # Letter range
./index --overwrite              # Force re-index (keeps existing covers)
./index --overwrite-with-images  # Force re-index + re-extract all covers
./index --inspect                # Re-check existing files for metadata changes
./index --prune                  # Delete rows for files gone from disk even past the 20% mount-blip guard
./index --resume                 # Continue from last checkpoint
./index --release "clxxxxxxx"   # Re-index a single release by LocalRelease ID
./index --folders "Artist/Album" # Re-index exact folder paths (semicolon-separated)
./index --skip-covers            # Skip cover art extraction
./index --threads 4              # Rayon thread count (default 8)
./index --delete                 # Delete local data for matched artists, then exit
./index --music-dir /path        # Override MUSIC_DIR env
./index --web                    # Emit PROGRESS:{json} for the web terminal
./index --resolve-artists        # Only resolve artist tags against MusicBrainz, no folder scan
./index --resolve-artists --dry-run  # Print the decisions, write nothing
./index --resolve-artists --only "Name"  # Scope resolution to one artist
./index --resolve-artists --overwrite    # Re-ask MB for every name in scope, ignoring the cache
./index --skip-resolve           # Skip the end-of-run artist resolution pass
./index --canonicalize-artists   # Only reconcile Artist rows with MusicBrainz, then exit (no network, no folder scan)
./index --canonicalize-artists --dry-run  # Print the clears/renames/connections, write nothing
```

`--release` cannot combine with `--from`, `--to`, `--only`, or `--folders`.

## CLI Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--from` / `-f` | String | - | Start letter filter |
| `--to` / `-t` | String | - | End letter filter |
| `--only` / `-o` | String | - | Semicolon-separated artist folder prefixes |
| `--exact` | bool | false | Exact match for `--only` (no prefix matching) |
| `--folders` | String | - | Exact relative folder paths to process |
| `--release` | String | - | Re-index single release by LocalRelease ID |
| `--overwrite` | bool | false | Re-index all tracks ignoring change detection (keeps existing covers) |
| `--overwrite-with-images` | bool | false | Like --overwrite but also deletes and re-extracts all cover art |
| `--inspect` | bool | false | Re-check existing files for metadata changes (size/mtime/hash) |
| `--prune` | bool | false | Delete rows for files missing on disk even when they exceed the 20% mount-blip ratio guard (only applies to folders this run walked and found files in) |
| `--skip-covers` | bool | false | Skip cover art extraction |
| `--resume` | bool | false | Resume from last checkpoint |
| `--delete` | bool | false | Nuke local data for matched artists, then exit |
| `--threads` | usize | 8 | Rayon thread count for parallel extraction |
| `--music-dir` | String | - | Override MUSIC_DIR from env |
| `--web` | bool | false | Emit PROGRESS:{json} for web terminal |
| `--emit-artist-ids` | String | - | Write processed artist IDs to file (one per line, used by refresh) |
| `--resolve-artists` | bool | false | Only resolve artist tags against MusicBrainz and rebuild links, then exit (no folder scan). Honours `--only`/`--from`/`--to`/`--exact`/`--folders`/`--release` for scope, and `--overwrite` to ignore the lookup cache |
| `--dry-run` | bool | false | With `--resolve-artists` or `--canonicalize-artists`: print decisions, write nothing |
| `--skip-resolve` | bool | false | Skip the end-of-run artist resolution pass |
| `--canonicalize-artists` | bool | false | Only reconcile `Artist` rows against `MbArtistLookup` (clear contradicted MB ids, rename to the canonical name, connect duplicates, sweep orphans), then exit. Pure SQL - seconds, no network, no folder scan. Honours the same scope filters as `--resolve-artists`; a scoped run makes only slug-stable renames |

## Output Modes

Without `--web`: colored, indented console progress. With `--web`: `PROGRESS:{json}` lines for the web UI progress bar, plus plain text for the terminal panel. The web UI appends `--web` automatically.

## Per-Folder Flow

1. **Walk** folder for audio files (mp3, flac, aac, opus, m4a, ogg) via jwalk
2. **Extract** metadata in parallel (rayon + lofty), including MB tags: `MUSICBRAINZ_ALBUMID`, `MUSICBRAINZ_RELEASEGROUPID`, `MUSICBRAINZ_ALBUMARTISTID`, `MUSICBRAINZ_ARTISTID`. Tag keys are matched on an alphanumeric-only normalization, because the same key arrives as `MUSICBRAINZ_ALBUMID` (Vorbis), `MusicBrainz Album Id` (TXXX) or `MusicBrainzReleaseId` (lofty's own name) depending on container
3. **Pre-scan** - propagate MB release/release-group IDs across tracks sharing same album/year/albumArtist
4. **Change detection** - default: skip if filePath exists in DB. `--inspect`: compare size/mtime/hash. `--overwrite`: skip change detection but preserve existing covers. `--overwrite-with-images`: skip everything and re-extract covers
5. **Store** the raw artist / albumArtist tags plus the multi-value `Artists[]` + `MusicBrainzArtistId[]` frames on the track. No artist identity is decided here - that happens in the post-loop resolve pass (see Artist Resolution below)
6. **Upsert** Artist (album artist only, at this stage), LocalRelease, LocalReleaseTrack, LocalReleaseArtist (batch UNNEST)
7. **Cover art** - extract from embedded tags or folder images, content-addressed by MD5 hash (same image bytes = one file, shared across releases)
8. **Delete** tracks no longer on disk. Guarded: if more than 20% of the DB rows under the prefix are
   missing, the pass assumes an unmounted share and deletes nothing. `--prune` bypasses that guard for
   folders this run walked and found audio files in (the mount is provably up), which is the only way a
   wholesale folder swap - old rip removed, new one dropped in, so ~half the rows look missing - ever
   loses its stale rows. The whole-library `detect_deleted_folders` sweep keeps the guard unconditionally.
   Favorites and playlist entries pointing at those tracks cascade away with them (a file replaced under
   a NEW name is a new track row - `filePath` is the identity). They are counted before the delete and
   reported once at the end of the run as
   `WARN: dropped N favourite(s) and M playlist entry(ies) for removed files`, which the web UI turns
   into an amber notice (`dropped_links_line` in `deletion.rs` ↔ `parseDroppedLinks` in
   `web/helpers/functions.ts`). Nothing is re-linked automatically.
   Every affected release is then reset to `matchStatus = UNKNOWN` so sync recomputes it. That statement
   used to also set `statusReason`, which is a **`MusicBrainzRelease`** column, not a `LocalRelease` one -
   so the whole UPDATE errored, `.ok()` swallowed it, and no pruned release was ever flagged. Fixed;
   `tests/prune_guard.rs` covers it and had been failing
9. **Update totals** for this artist's releases and tracks
10. **Set `lastIndexedAt`** on Artist (only if new/updated/deleted tracks in folder)
11. **Stamp run hash** on FolderScan for resumability
12. **Upsert FolderScan** - stores folder mtime

Post-loop: detects entirely deleted folders (only when unfiltered), resolves artist identity and rebuilds
owner/credit links (skippable via `--skip-resolve` - see Artist Resolution below), safety-net pass
re-extracts missing release images.

## Locking & Resumability

Acquires a named DB lock (`"index"`). Clears stale locks older than 10 minutes. SIGTERM/Ctrl-C handlers release the lock on shutdown; second Ctrl-C force-exits. Checkpoint saved per-folder for `--resume`.

Run hash stored in `Settings.indexRunHash`. On restart, folders already processed (matching hash in `FolderScan`) are skipped entirely. Hash cleared on completion. `--overwrite` generates a new hash. Targeted ops (`--release`, `--folders`) bypass hash.

## Release Grouping

**One folder = one `LocalRelease`.** `build_group_key` (`scripts/index/src/db.rs`) keys a release on the containing folder alone: `"folder:{folderPath}"` (root-level files with no folder fall back to `"meta:{slugTitle}:{year}:{slugArtist}"`). The folder is treated as a *structural* boundary — its name is never parsed for metadata values; title/year/artist come only from tags, then from the MusicBrainz match.

Per-track MB ids (`mb_release_id` / `mb_release_group_id`) are **not** part of the group key. They identify which release a *recording* appears on, not which folder-album a *file* belongs to — keying on them shredded compilations (whose tracks carry their original sources' ids) into per-track fragments. The ids are still stored per-track for sync's matcher.

Display title/year for the release come from the folder's **majority (mode)** `album`/`year` tag (`folder_majority_title_year`), so a folder whose tracks disagree still gets a deterministic name (sync overrides it with the MB title once matched).

`folderPath` scoping means the same album ripped into two folders creates two separate `LocalRelease` rows — genuine duplicate copies. Sync binds both to the same `MusicBrainzRelease` via `releaseId`; the web UI collapses them into one card, and the `duplicate-release` audit rule surfaces them for review.

**Compilations link many artists to one release.** Index creates one `LocalReleaseArtist` link per distinct `albumArtist` tag in the folder (main artists). A comp tagged `albumArtist = "Various Artists"` gets one link; a per-source-tagged comp (each track credited to its original performer) gets N links to the *same* single `LocalRelease` — shared via the many-to-many table, not duplicated per artist, so it appears on each of those N artists' pages.

### Multi-disc folders and box sets

Sibling disc folders (`CD 1`, `CD 2`, ...) fold into one `LocalRelease` when their tracks agree on a
majority embedded MB release id and their disc numbers are disjoint — `index::db::plan_disc_merges`,
built from every folder's facts before the per-track loop runs. Folder names carry no weight; this is
decided purely from tags, which is also why it can't see a box set whose discs are mis-tagged (or
genuinely tagged) as their own standalone albums — MusicBrainz has no box-set entity, a box is one
Release with N media, and it stores no id-level link from a disc to the album it duplicates
(`docs/box_sets.md`). Those cases are folded afterwards by `sync --repair-multi-disc`'s tier-2
tracklist matcher (`sync::boxset`), which writes a `LocalReleaseMember` row per disc.

**`get_local_release_members` runs before both `plan_disc_merges` and `build_group_key`.** A folder
already bound by `sync::boxset` is routed straight to its existing `LocalRelease` id and its
title/year left untouched — without this check, a box whose discs all read `discNumber=1` in their
own tags (nothing in the file ever said "I am part of a box") would be split straight back apart the
next time `--overwrite`/`--prune` re-indexes those folders, since a plain index has no other way to
know the fold happened.

## Cover Art Deduplication

Cover images are content-addressed: the filename is the MD5 hash of the image file (`{hash}.jpg`). Multiple `LocalRelease` rows can share the same image - e.g. a 90-disc box set extracts one cover instead of 90.

Two levels of deduplication:
- **MB ID shortcut**: Releases sharing `mb_release_id` or `mb_release_group_id` with an already-processed release skip extraction entirely and reuse the known content hash
- **Content hash**: After extraction, if `{hash}.jpg` already exists on disk, the duplicate is discarded

Works with all storage modes (`local`, `s3`, `both`). S3 uploads happen once per unique hash. Shared images are reference-counted on delete - the file is only removed when no `LocalRelease` points to it.

## Artist Resolution (MusicBrainz-validated)

**A separator is never, by itself, evidence of a split.** Real artists are called "Nurse With Wound",
"MAN WITH A MISSION", "Mumford & Sons", "Earth, Wind & Fire". Measured against production data, the old
punctuation-guessing splitter split **721 of 722** distinct `" with "` tag values - including four bands
that own releases in this library. A hardcoded exception list cannot fix that; the list is unbounded.

So the question is asked of MusicBrainz instead: *is this whole string an artist?* Only a definitive "no"
justifies looking for a split, and every candidate grouping is validated the same way
(`common::mb::resolve`).

### Two phases

The pass runs as **Phase A** (network) then **Phase B** (offline), not interleaved:

* **Phase A** walks the distinct tag values, sorted case-insensitively, and asks MusicBrainz about each
  one. The product is the memo plus the `MbArtistLookup` rows - the `Resolution` itself is discarded.
* **Phase B** walks the tracks and writes the owner/credit links. Every name is memoized by then, so it
  makes no network calls.
* Then a **Phase C** tail, also offline: `canonicalize_artists` (see below) reconciles the `Artist` rows
  themselves with what MusicBrainz said, and `delete_orphan_artists` sweeps whatever the reconcile left
  linked to nothing.

Three things follow from the A/B split. Progress is alphabetical and its counter is honest (the old
track-driven loop reported `resolved_names.len() + 1`, a different population that stalled and repeated
whenever a name deferred). A crash is cheap: the pass has no checkpoint, so `MbArtistLookup` *is* the
resume state, and a rerun skips every name already answered - `--overwrite` skips the cache warm to force
a full re-ask. And the run's cost is visible up front, as `Resolving N of M (M-N already resolved)`.

**The warm loads the whole cache table, not just the tag values being resolved.** Tier 3 takes a compound
apart and asks about the *atoms* inside it, and an atom is usually not itself a distinct tag value — so
warming by name left every atom a memo miss and sent the resolver to MusicBrainz for an answer already in
the table. Measured on the live library, a 3-minute run made 57 network lookups and inserted **zero** new
rows: every request re-asked a name it already knew. Loading the table whole (~44k rows, a few MB — the
folder scan already does this) cut the pending set from 44,544 names to 34,874 in one step.

### Search order

| Tier | Source | Cost |
|---|---|---|
| 0 | Embedded tags: `Artists[i]` paired with `MusicBrainzArtistId[i]` | free |
| 1 | `MbArtistLookup` cache (hits **and** misses, 30-day negative TTL) | free |
| 2 | MB search for the **whole string** - a hit means one artist, no split | 1 request |
| 3 | Memoized contiguous-span recursion over separator positions, coarsest grouping wins | O(n²) requests |
| 4 | Fallback: the atoms are the artists, unverified | free |

Tier 0 carries most of the library: Picard writes one `Artists` value and one `MusicBrainzArtistId` per
credited artist, so when the two line up the split is already done, authoritatively, with MB ids attached.
(Those frames are multi-value; `metadata.rs` collects every value rather than last-wins.)

A **single** pair counts too, but only when that one value *is* the whole tag - which is what makes
separator-bearing band names like "Kool & the Gang" safe without any network call. The equality guard is
not theoretical: of 3,308 single-pair tracks measured, 3,307 match their tag and exactly one does not -
tag `"The B.B. King Blues Band"` with the embedded value `"B.B. King"`. Trusting that pair would replace
the band with the person, so a mismatch falls through to the lookup instead.

Tier 3 is a span search, not a subset search: `resolve_span(i,j)` asks about a contiguous run of atoms and
recurses on misses, memoized per span. That is O(n²) lookups instead of the O(2ⁿ) of trying every separator
combination, and it prefers the **coarsest** valid grouping - `"Y & Z with A"` yields `"Y & Z"` + `"A"` when
MB knows the duo. Above 8 separators (~0.1% of names) only the whole string and the atoms are tried.

A transient failure (timeout, 503) yields **deferred**: the name is left alone and retried next run. Only a
definitive MB "no match" is allowed to trigger a split, so a network blip can never permanently shred a band
name. Deferred answers are never cached, so a deferred name is genuinely re-asked rather than pinned.

### Separators

Word separators (` featuring `, ` feat. `, ` ft. `, ` with ` ⇒ guest; ` vs `, ` and `, ` & `, ` x `, `; `,
`, ` ⇒ co-billing) plus typographic ones: ` / `, ` + `, ` · `, ` • `, ` ♦ `, ` \ `, `\\`, `\`, `|`.

Three rules the list encodes:

* **Spaces are required** on `/` and `+`. Bare `"AC/DC"` and `"Akio Suzuki/Takehisa Kosugi/Riri Shimada"`
  are the same shape, and only the first is protected by a tier-2 hit; a tier-4 fallback on the second
  would emit unverified owner atoms. The names stay whole instead.
* **`\\` is listed before `\`.** ID3v2.3 has no multi-value frame, so taggers join with a doubled
  backslash. Matched one byte at a time, the first `\` was the separator and the second rode along on the
  next atom - `"Mal Waldron\\Jim Pepper"` produced a browsable artist called `\Jim Pepper`, which then
  *passed* MB verification because `normalize_name` strips punctuation before comparing.
* **Dangling markers are trimmed, not split.** `trim_separator_noise` strips leading/trailing separator
  punctuation before anything is looked up, because tier 2 runs before any split and would otherwise
  cache and name the artist under the decorated spelling. Guarded on the result still holding a letter or
  digit, so bands that are entirely punctuation ("+/-", "!!!") survive intact.

### Pacing

`common::mb::api::RateLimiter` paces requests at a floor of 1100ms (`MB_MIN_DELAY_MS` overrides it,
clamped 1100-10000) and adapts from there: a rate limit doubles the delay up to a 10s cap, each success
sheds a flat 100ms back toward the floor.

Two distinctions matter. A 503 is classified as **rate-limit** or **server overload** by its body and
`X-RateLimit-Remaining` header, and only the former slows the steady-state pace. And the penalty applies
at most **once per request**, not once per retry: five retries of one unlucky name used to walk the delay
1100 → 10000 and pin every later name at the cap. `Retry-After` wins over the local backoff ladder when
MusicBrainz sends it.

**Most 503s on this API are not us.** Measured live during a resolve run, the body reads
`{"error": "The MusicBrainz web server is currently busy. Please try again later."}` and arrives with
`x-ratelimit-remaining: 14` of `x-ratelimit-limit: 15` and `retry-after: 0` — we are using a fifteenth of
the allowance and the server is simply load-shedding. Slowing down does nothing for it; an earlier attempt
to fix this by raising the floor to 1300ms cost throughput and bought nothing, and was reverted.

So an overload 503 is handled as what it is: it served no data, so the retry does **not** re-pay the
inter-request delay (a 250ms floor keeps it from becoming a hot loop), and it is **not** logged. Roughly a
third of requests on a long run take that path and recover on the first retry; warning about each one made
a healthy run read as a failing one. The total is reported once in the run summary as
`Absorbed N transient MusicBrainz 503(s)`. Only `deferred` counts names that actually failed.

**Offline backstop.** `KNOWN_SINGLE_ARTISTS` (`common/src/artists.rs`) is consulted before any split is
contemplated: a band already known to be one artist stays whole even if MusicBrainz answers "no such
artist" (a rename, an aliased entry, a bad response). MB is still asked for the id - only the split is
suppressed. Matching is on the normalized name, so one entry covers every punctuation spelling
("Florence + the Machine" / "Florence & The Machine"). It is a floor, not the authority, and does not need
to be exhaustive.

Worked examples of the two safety levels:

| Tag | Candidate split? | Survives because |
|---|---|---|
| `AC/DC` | none - bare `/` is not a separator | structurally unsplittable |
| `Florence + The Machine` | none - `+` is not a separator | structurally unsplittable |
| `Kool & The Gang` | yes (`" & "`) | embedded single pair, MB hit, **and** the backstop |
| `Tom Petty and the Heartbreakers` | yes (`" and "`) | embedded single pair, MB hit, **and** the backstop |

### Finding the bad tags at source

Everything above is the pipeline *surviving* bad tags. To find and fix them at source instead, run
`./problems` - a read-only scan of every file in the library that reports each tag condition known to
break or degrade this pipeline, with the consequence spelled out per file. See
`docs/scripts/problems.md`.

### Candidate separators

`,` `;` `/` `\` `|` ` & ` ` and ` ` vs ` ` x ` `feat.` `ft.` `featuring` ` with `. These only *propose*
split points - MB decides. (`" and "` is new; previously `"Frank Sinatra and Count Basie"` had no split point at
all and survived as a single junk artist.) A comma between digits ("10,000 Maniacs") is never a separator.

### Owner vs credit

Two relationships, mirroring MusicBrainz artist credits and Spotify's discography / `appears_on` split:

- **Owner** → `LocalReleaseArtist`. Appears in `/browse`, counted in stats, synced to MB.
- **Credit** → `TrackRelatedArtist`. Has its own page and is searchable, shows the release under
  appearances, but is excluded from browse/stats/sync.

The **join phrase decides** which one a resolved part becomes:

- guest phrases (` with `, `feat.`, `ft.`, `featuring`) ⇒ the first part **owns**, the rest are **credits**.
  `"Frank Sinatra with Count Basie"` ⇒ Sinatra owns the album, Basie is credited on the track.
- co-billing (` & `, `,`, `;`, `/`, ` and `, `vs`) ⇒ all parts **co-own**. `"B.B. King & Eric Clapton"`
  (*Riding With the King*) ⇒ both own it.

An Artist row is created for a credit **only when MusicBrainz verified the name**. Unverified tier-4 atoms
are never turned into browsable artists - that is exactly the junk this design exists to prevent. Dangling
role fragments ("His Orchestra", "Chorus", a leftover "special guests") are dropped rather than created.

`albumArtist` is no longer taken verbatim (reversing `bef2267b`): it goes through the same resolver, which
is what finally splits compound album artists like `"Frank Sinatra with Billy May & His Orchestra"` - but
only into artists MusicBrainz confirms.

**Ownership is derived, never stored.** There is no `relatedOnly` flag; "owns something" is
`EXISTS(LocalReleaseArtist)`. A cached boolean is what silently read 0 for two and a half months.

Because credits can point at an artist that owns nothing, `delete_orphan_artists` must check **all three**
link tables (`LocalReleaseArtist`, `MusicBrainzReleaseArtist`, `TrackRelatedArtist`) - omitting the third
deletes every credit artist the resolver just created. See `scripts/index/tests/orphan_cleanup.rs`.

### Cleanup is scoped to the run

`delete_empty_releases`, `delete_orphaned_mb_releases` and `delete_orphan_artists` take an `ArtistScope`.
On a filtered run (`--only`, `--folders`, `--from`/`--to`) that scope is the artist set the run actually
touched; only an unfiltered run sweeps the whole library. Unscoped, a one-artist rescan was a library-wide
mutation - it garbage-collected rows for artists it had never looked at and could not reason about.

They also run **once, after the folder loop**, not once per folder as they used to: three full-table
anti-joins × ~25k folders, for a result nothing inside the loop reads. `detect_deleted_folders` stays
unscoped by design and is gated on `!has_filter` - a partial scan has no business concluding that the
folders it didn't visit are gone.

`--resolve-artists` has no folder loop, so it derives its own orphan scope: the artists linked to the
releases in scope, captured **before** the pass runs. It has to be before - unlinking is exactly what the
reconcile does, so afterwards there is nothing left to join on. This scope is why the flag no longer
strands rows: it previously ran neither cleanup at all, and 8,216 zero-link artists had accumulated.

### When ownership is written

The folder loop cannot simply wait for the resolve pass to create owners: `lastIndexedAt`, the artist folder
image, totals and `--emit-artist-ids` are all driven by the artist set the loop produces, and a release left
ownerless is invisible in `/browse`, unsyncable, and (before the fix below) deletable by `./delete`'s sweep.
On a full run that window would last days.

So the loop still writes owners - but it resolves the **owner tag** offline first, using only the free tiers
(embedded pairs, the `MbArtistLookup` cache, the backstop). Tier 4 is explicitly rejected here: a cold cache
must never blind-split `"Kool & The Gang"`. When offline resolution can't decide, the verbatim tag is written
as a **provisional** owner and corrected later in the same run.

**The owner tag is not always `albumArtist`.** On a Various-Artists compilation the placeholder names nobody,
so the track's own `artist` tag decides ownership instead - the contributors co-own the compilation. One
definition of that choice, `index::resolve::owner_tag`, is called from both the folder loop and the reconcile.
It has to be: the two used to have their own copies and drifted. The loop had the VA fallback, the reconcile
read `albumArtist` alone, so on a VA release "Various Artists" resolved to nothing, the release never entered
the desired set, the empty-set guard below skipped it, and the raw compound the loop had written stayed an
owner **forever**. 497 of those had accumulated -
`"Aaron Neville, Kenny G, Walter Afanasieff, John \"JR\" Robinson, ..."` owning *The Bodyguard OST*.

The resolve pass then runs an **ownership reconcile** that replaces those provisional owners, guarded so it
can never make things worse:

| Guard | Why |
|---|---|
| Desired set = union across **all** distinct owner tags on the release | 11 of 435 releases measured carry more than one; overwriting from a single track would strip co-owners. On a VA compilation this union is what makes every contributor an owner |
| Skip the release if any of its owner tags **deferred** | never rewrite ownership on an incomplete picture during an MB outage |
| Skip if the desired set is empty | a release whose owner tag resolves to nothing keeps whatever the folder scan established |
| `is_special_artist_name` parts are never owners | a tier-0 pairing can hand back the placeholder itself (`{"Various Artists", "Whitney Houston"}`) |
| `cap_co_owners` on both sides | a tag naming 44 session musicians is a personnel list; the first owns, the rest become credits. The loop caps too, or a warm cache writes 44 provisional owners for the pass to trim |
| Insert new owners before deleting stale ones, one transaction | a release must never pass through zero owners |
| Delete only within the release scope in play | targeted runs stay targeted |

`delete_orphan_artists` runs after the reconcile - in `--resolve-artists` mode too, where it used to be
skipped entirely, leaving every artist the reconcile unlinked behind as a zero-link row (8,216 of them had
piled up). Covered by `scripts/index/tests/owner_reconcile.rs`.

On a warm cache the loop resolves correctly on the spot and no provisional owner is ever written - the second
`--only` run of an artist typically costs **0 MB lookups**. The cost is paid once, on a cold cache.

### Artist folder image

The image follows ownership rather than the folder name. The **primary** owner (first album artist resolved
for the folder) always receives it; the other resolved owners receive it only if they have no image yet.
Previously this fired only for single-artist folders, so a folder whose `albumArtist` was
`"Ella Fitzgerald & Roy Eldridge Sextet"` handed its image to the compound junk artist - and once album
artists split, such folders would have contributed no image at all.

### Canonicalizing artist rows

An `Artist` row is created from a *tag string*, once. `common::db::ensure_artist` upserts
`ON CONFLICT (slug) DO UPDATE SET "updatedAt"`, so whoever inserted a slug first owns its spelling forever -
and `make_slug` strips punctuation, which means `"\Jim Pepper"` and `"Jim Pepper"` are the **same row**,
stuck under the decorated name. `canonicalize_artists` reconciles the rows with what MusicBrainz actually
said, from `MbArtistLookup` alone - no network, no audio files, seconds on the live library:

1. **Clear contradicted MB ids.** The row carries a `musicbrainzId` its own lookup row denies
   (`mbid IS NULL` - MB was asked about that exact string and said no). Scoped to `lastSyncedAt IS NULL`:
   sync answers a different question, with a tolerant predicate, about an artist it is already committed
   to, and its ids are not ours to overrule.
2. **Rename to the canonical name** when `MbArtistLookup.mbName` differs. Free slug ⇒ rename both fields;
   slug unchanged (punctuation-only: `"\Jim Pepper"`, `'` vs `’`) ⇒ a pure display fix with no URL churn.
   A taken name or slug is skipped - that pair is a duplicate, handled next.
3. **Connect duplicates** via `primaryArtistId`, so the twin drops out of `/browse` and its catalogue
   aggregates onto the primary. Primary = most `LocalReleaseArtist` links, tie-broken by `createdAt`.
   Never a delete: folding two rows into one is `./fix --duplicates`' job, which has the genre/URL/playcount
   merge and an undo trail.

Two guards, and both were load-bearing when measured against the live library:

**`Artist.musicbrainzId` is not a safe merge key.** 3,115 ids were shared by more than one row, but almost
all of those are leaks: `"Lena Horne & Gábor Szabó"` carries Lena Horne's id with zero links, while its
lookup row says MB denied the string. Merging on the column alone folds collaborations into their first
member. So both names must have a lookup row resolving to the same id - MusicBrainz corroborating the pair
rather than us inferring it. 3,115 candidate groups → 172.

**Sharing an MB id is still not enough**, because `mb_artist_exact` matches on MusicBrainz **aliases**. The
lookup table legitimately reports `"Simone" → Nina Simone`, `"ANT" → Adam Ant`, `"Lowe" → Nick Lowe` - MB
saying the string *can* refer to that artist, not that it is their name. A library tagged
`albumArtist = "Simone"` means the Brazilian singer. So steps 2 and 3 additionally require the two spellings
to **normalize to the same key** (case, punctuation, a leading "the", and `&` vs `and` all folded). Variant
pairs still merge (`Iron And Wine` / `Iron & Wine`, `Chi-Lites` / `The Chi-Lites`,
`Teddy Wilson & His Orchestra` / `Teddy Wilson and His Orchestra`); alias hits are dropped. 172 → 108
connections, 1,343 → 1,295 renames.

**Scoped like every other cleanup.** `./index --only "X"` must stay about X - the artist page's *Scan
catalogue* button issues exactly that, and an unscoped pass would rename ~1,300 unrelated artists behind
a one-artist refresh. Steps 1 and 2 filter on artist id; step 3 filters on **MBID** instead, because the
twin of an in-scope row is by definition usually out of scope and filtering it out would make every group
look like a singleton. Measured: unfiltered `6474 / 1295 / 108`, `--only "Frank Sinatra" --exact`
`1 / 5 / 4`.

A scoped run also makes **only slug-stable renames**. Punctuation-only fixes still land
(`\Jim Pepper` → `Jim Pepper` slugifies identically), but `Ink Spots` → `The Ink Spots` moves the URL, and
doing that under a user who is sitting on `/artist/ink-spots` watching the scan terminal is not a targeted
change. Those wait for the library-wide pass, which is a deliberate maintenance action.

Runs at the end of every resolve pass - so every UI scan button already gets it, with no argument changes
- and standalone as `--canonicalize-artists` (`--dry-run` prints the clears, renames and connections
without writing). Covered by `scripts/index/tests/canonicalize.rs`.

### Resolution order doesn't matter

Folders scan alphabetically, so a guest may not exist yet when their host album is indexed. The resolve pass
runs **after** the folder loop and re-derives from the current DB, so an artist indexed later still ends up
correctly linked; a credit whose name no longer matches anything is removed rather than left stale.

## Running on NAS

```bash
sudo docker exec dmp index --from=e --to=fz
```
