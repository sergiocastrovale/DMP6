# Indexer fragmentation + sync under-matching — RESOLVED

> **STATUS: RESOLVED (2026-08-02).** Both the index-time fragmentation and the
> sync under-matching it exposed are fixed and validated on the NAS. The
> diagnosis below is kept as the historical record; the shipped algorithm lives
> in `docs/scripts/index.md` (grouping) and `docs/scripts/sync.md` (matching).

## What shipped

1. **Index groups by folder, not by per-track MB id.** `build_group_key`
   (`scripts/index/src/db.rs`) now keys a `LocalRelease` on `folder:{folderPath}`
   — the physical folder is the release unit. The release's display title/year
   come from the folder's **majority (mode)** `album`/`year` tag
   (`folder_majority_title_year`). Per-track MB ids are still stored on
   `LocalReleaseTrack`; they just no longer split a folder. Result: one folder =
   one `LocalRelease`. `--overwrite` re-index re-points tracks and cleanly
   replaces the old fragment rows (no separate 42k-row repair pass needed).
2. **Sync consensus threshold** (`get_majority_id`): the majority MB id must be
   unanimous OR a real plurality (count ≥ 2 and strictly greater than any rival);
   a folder of all-distinct per-source ids yields no consensus → `UNMATCHED`
   rather than binding an arbitrary source single.
3. **No-singles allow-list** (`scripts/sync/src/allowlist.rs`): a match binds
   only if the MB release-group primary type is Album/EP, the release status is
   Official, and no non-music secondary type is present. Applied at every match
   tier and to catalogue-gap creation. Singles/broadcasts/bootlegs are rejected.
4. **Removed the shared-releaseId guard** (former audit #24). It unmatched every
   legitimate duplicate folder-copy of an album; with folder-grouping those are
   genuine duplicates, surfaced by the `duplicate-release` audit rule instead of
   blocked at match time.
5. **Guarded Tier-3 search fallback**: when a release carries no usable MB-id
   consensus (per-source-tagged comps), sync searches MB by album title + artist
   and binds only on a strong, gated match (score ≥ 85, similar title,
   allow-list Official Album/EP, track-count-confident edition). Never overrides
   an embedded id; never binds a Single.

## Validated (NAS, per-artist index+sync)

- Teddy Wilson: 763 → 221 releases (1:1 per folder); matches 52 → **139/221**
  after the sync fixes, all Album, zero singles; the "Portrait" 65-way id
  collision → 1.
- Adelaide Hall: 55 → 22 releases; matches 0 → **15/22** (the earlier 0 was a
  validation typo — `--only "Adelaïde Hall"` with a diaeresis skipped artist
  "Adelaide Hall"). Duplicate copies now all bind (A Centenary Celebration 5/5,
  Crooning Blackbird 7/7).
- Steve Earle (control): 111 → 60 releases, well-tagged albums unregressed,
  multi-edition "Guitar Town" intact, zero singles.

Remaining `UNMATCHED` after the fix is almost entirely (a) albums credited to a
*different* guest/collab artist that merely sit in the folder — a `--only`
scoping artifact that resolves in a full library sync; and (b) genuinely
per-source-tagged comps with incoherent album tags (need re-tagging; the search
fallback correctly declines rather than mis-bind). **Per-artist `--only` sync
undercounts — a full library sync matches materially more.**

## Compilation → artist linkage (many-to-many, shared not duplicated)

A compilation is **one** `LocalRelease` row connected to N artists via the
many-to-many `LocalReleaseArtist` table (one main-artist link per distinct
`albumArtist` tag in the folder), binding to **one** `MusicBrainzRelease`.
Nothing is duplicated per artist; the same row appears on each linked artist's
page through the join. A well-tagged comp (`albumArtist = "Various Artists"`)
gets one link; a per-source-tagged comp gets N links (and shows on N pages) —
a symptom of the bad tagging, fixed by re-tagging, not a duplication bug.

## Still open

- **Broad rollout**: only a few artists re-indexed/re-synced so far. Full
  re-index ≈ 5 days — run per-artist or in `./index --from= --to=` letter
  batches (each folder: index `--overwrite`, then a **full** sync afterward,
  not `--only`, to catch cross-credited albums).
- Re-run `./audit --duplicate-release --mismatched-release-id` after a broad
  re-index (the current audit tables hold stale pre-fix counts).
- Box-set disc subfolders named like `CD 2 - Warmin' Up` aren't collapsed by
  `strip_disc_subfolder` (suffix isn't pure-digit) → each disc is its own
  release. Orthogonal, tracked separately.

---

# Historical diagnosis (kept for the record)

## Summary

`./index` is silently shredding a large fraction of the library into bogus
single-track `LocalRelease` rows. **42,444 of 208,535 `LocalRelease` rows
(20.4%) have exactly 1 track**, and **42,422 of those (99.95%) share their
exact folder path with other `LocalRelease` rows** — i.e. they are not real
singles, they are fragments of one physical album folder that got split into
many DB rows. Only 22 one-track releases in the whole library are genuinely
standalone.

Discovered 2026-07-31 while verifying two new audit rules (`duplicate-release`,
`mismatched-release-id`) against production data: 70% of the "duplicate
release" hits traced back to these fragments coincidentally colliding on
track-count(1) + similar duration with other unrelated fragments.

## Concrete example

Folder `Teddy Wilson/Album/2011 - Jazz Heroes - Teddy Wilson/` (one physical
compilation) is split across **17 different `LocalRelease` rows** — 14 of
them holding exactly 1 track each. All 65 rows sharing MusicBrainz release id
`dohsul86k8ak80phwq6mzerw` (title "Portrait", actually a Lester Young box set)
are `LocalRelease.title = "Portrait"` even though their folders are 65
completely unrelated Teddy Wilson compilations — because the embedded `ALBUM`
tag on every track in this batch of files literally says `"Portrait"`,
regardless of which real compilation the file lives in.

## How it came to be

`scripts/index/src/main.rs`, per-track loop starting ~line 632:

1. A pre-scan (lines 591-618) builds a per-folder "consensus" map,
   `mb_release_id_by_meta`, keyed by the track's own `(album, year,
   albumArtist)` tag triple — intended to backfill an MB id for tracks that
   don't carry their own.
2. But the per-track resolution (lines 697-708) only consults that fallback
   if the *individual track* lacks a sanitized `mb_release_id`:
   ```rust
   let effective_release_id = sanitized_release_id.as_deref().or_else(|| {
       mb_release_id_by_meta.get(&meta_key).map(|s| s.as_str())
   });
   ```
   If every track in the folder carries its **own** valid MB release id —
   common for scraped/reissued compilations where each song was individually
   tagged with the MB id of its *original* vintage single/session, not a
   shared id for the compilation as a whole — the per-track id always wins.
3. `build_group_key()` (`scripts/index/src/db.rs:30-56`) folds that
   per-track id into the `groupKey`. Different per-track ids inside one
   folder therefore produce different `groupKey`s, and one physical folder
   is split into as many `LocalRelease` rows as there are distinct embedded
   ids among its tracks.
4. Downstream, `sync`'s matcher (`scripts/sync/src/main.rs` ~line 1021-1057,
   Tier 1) is actually sound in isolation — it takes a **majority vote** of
   `mb_release_id`/`mb_release_group_id` across a `LocalRelease`'s own
   tracks. But a majority-of-1 is always "unanimous," so each 1-track
   fragment confidently resolves straight to whatever specific MB release
   that one embedded id points to — which, for an individually-tagged
   vintage recording, is very often typed `Single` in MusicBrainz. This is
   the direct mechanism by which singles enter a library that should never
   contain any: the fragmentation bug upstream manufactures the exact
   one-track inputs that make a single-type match look confident.

Sync's fuzzy/title-search fallback (former "Tier 3") is already intentionally
disabled — "Strict policy: metadata wins... to avoid collapsing distinct
editions onto a single MB release" (`scripts/sync/src/main.rs:1131-1133`).
That principle is correct and already in place; the bug is entirely upstream
of sync, at index-time grouping.

## Constraints for any fix

Stated requirements, non-negotiable:

- **Filesystem is never source of truth.** Folder/file *names* must never be
  parsed as data (artist/album/year/etc.) — only embedded file tag metadata
  counts. (Using folder path as an opaque grouping/disambiguation token —
  today's existing behavior for telling two physically distinct copies of
  the same edition apart — is not "trusting" it as metadata; nothing about
  it should change.)
- **Metadata is source of truth, and metadata correctness is established by
  matching against MusicBrainz** — not by local fuzzy heuristics. Sync's
  existing strict policy (majority-vote or leave `UNMATCHED`, no fuzzy title
  search) is correct and should stay as-is.
- **No singles, ever.** Finding, syncing, or matching a local release to an
  MB release typed `Single` must be impossible, not just unlikely.

## Proposed direction (not yet implemented)

Two independent changes, both needed:

**1. Fix index-time grouping (root cause).** Tracks should be grouped into
one `LocalRelease` based on their own embedded `ALBUM` / `ALBUM ARTIST` /
`YEAR` tags (legitimate file metadata) — not on each track's individual
`mb_release_id`/`mb_release_group_id`. Those per-track MB ids should still be
stored per-track (sync already needs them for its majority vote), but must
stop being part of `build_group_key`'s grouping key. This directly fixes the
Teddy Wilson case: 17 tracks sharing one `ALBUM` tag value become one
17-track `LocalRelease`, and sync's existing majority-vote logic then either
finds a real consensus MB id or — correctly, per the existing strict policy —
leaves it `UNMATCHED` rather than fragmenting.

**2. Explicit single-type guard in sync (defense in depth).** Independent of
fix #1, `scripts/sync/src/main.rs`'s matching tiers should reject any
resolved release-group whose `primary_type` is `Single` outright — mirroring
the existing `ALLOWED_GAP_TYPES = {album, ep}` convention already used in
`web/server/utils/releaseAggregation.ts` for MISSING gap cards. This makes
"no singles" true even if some other path someday produces a 1-track
majority-vote match.

**3. Repair the ~42k already-fragmented rows.** Once #1 ships, re-indexing an
affected folder with `--overwrite` will naturally produce the correct single
grouped `LocalRelease` — but the *old* fragment rows won't disappear on their
own (their `groupKey`s no longer get produced, so nothing overwrites them).
A cleanup pass is needed to delete stale 1-track fragments whose folder now
has a superseding multi-track `LocalRelease` after re-index. This needs
careful scoping (safe identification of "superseded" fragments, favorite/
play-count/history data on the fragments to consider) before running against
production — a separate, explicit decision, not bundled into #1's code fix. 
For this reason, a custom SQL script must be very carefully written and all tweaks
should be handled by it.

## Open questions to resolve before implementing

- Does `build_group_key` still need *any* MB id in the key at all (e.g. to
  distinguish two genuinely different real albums that happen to share
  identical `ALBUM`/`YEAR`/`ALBUM ARTIST` tags), or is tag-identity alone
  sufficient now that folder path already disambiguates same-tag-different-
  folder cases?
- For fragment repair: is a targeted re-index of only the ~42k affected
  folders acceptable, or does this warrant a full library re-index?
- Should the single-type guard (#2) also block `--catalogue-gaps` (the fast
  MISSING-entry populator) from creating gap cards for singles, or is that
  already covered by the existing `ALLOWED_GAP_TYPES` filter?
