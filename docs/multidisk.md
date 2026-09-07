# Box sets & multi-disc releases — implementation spec

Replaces the rejected design shipped in commits `98ac101c`/`458f9ac7`/`32f088ab`/`f0b048e6`.
Prod DB currently at pre-box-set baseline (user restored a backup). Nothing to untie.

Baseline census (pre-repair): 3064 sibling-folder groups / 10230 `LocalRelease` rows. 801 groups share one embedded MB release id (plain multi-disc, fold candidates). ~4700 multi-medium MB releases, 4460 local rows bound to them currently read `MISSING_TRACKS`. Two shapes seen: (a) every sibling disc tagged with the box's own id, disjoint `discNumber` — box permanently `MISSING_TRACKS`; (b) every sibling tagged as its own standalone album (`discNumber=1` on all), only a bonus/rarities disc carries the box id — 8/9 correct already, only the bonus disc broken. Design must not regress shape (b)'s already-correct rows.

## 1. MB facts (verified, load-bearing)

- No box-set entity/type in MB. A box = one `Release`, N `media`. `packaging` unreliable. Only signal: `mediumCount > 1`.
- No id-level link from a box disc to the standalone release it reprints. Release group ≠ that link (RG = editions of one album; a box is its own release in its own RG).
- Shared identity = **recording** (`track.recording.id`, aka `recordingId`), not the release-scoped track id. Already in every `inc=recordings` payload sync fetches — zero extra API calls to use it.

## 2. Schema (additive only, never `db push`)

```prisma
model LocalRelease {
  // existing fields unchanged
  mediumPosition    Int?      // which medium of releaseId this folder is. NULL = whole release (single-medium, or folded multi-disc)
  boxReleaseId      String?   // dissolved-box provenance: this folder is disc boxMediumPosition of box boxReleaseId
  boxMediumPosition Int?
  box               MusicBrainzRelease? @relation("BoxDiscs", fields: [boxReleaseId], references: [id])
  @@index([boxReleaseId])
}

model MusicBrainzRelease {
  // existing fields unchanged (mediumCount already exists)
  releaseGroupSecondaryTypes String[] @default([]) // from RG payload already fetched for allowlist::is_allowed; [] = "original work"
}

model MusicBrainzReleaseMedium {
  // existing fields unchanged (recordingFingerprint, equivalentReleaseId, equivalentReleaseGroupId already exist)
  equivalentMediumPosition Int? // which medium of equivalentReleaseId this equals. NULL when target is single-medium.
}

// MusicBrainzReleaseTrack.recordingId, LocalReleaseMember: already declared, keep as-is
```

`LocalReleaseMember`: fold's member list + undo log. One row per folder absorbed into a fold, carrying `folderPath`+`discNumber`. Written only by fold path, never by dissolve path. **Not optional**: shape (b) folders all carry `discNumber=1` in their own tags — without a sticky record, the next `--overwrite`/`--prune` re-index would re-split them back into separate `folder:` rows and reset disc numbers, churning the survivor's identity (and its `FavoriteRelease`) every scan. `index` must look up a folder by path in this table *before* building a group key, ahead of both disc-merge planning and `build_group_key`.

Migration `20260907000000_box_sets` must be rewritten idempotent (`IF NOT EXISTS` / `DO $$ EXCEPTION WHEN duplicate_object`) — prod has some of these objects already from a prior partial apply, missing `recordingId`. New migration `20260908000000_multidisk` adds the fields above.

## 3. Discriminator

1. `mediumCount = 1` → never a box, never folds. Equivalence pass never runs against it. Ordinary release path unchanged.
2. `mediumCount > 1`, ≥2 media have an equivalent → **box, dissolve**.
3. `mediumCount > 1`, 0 or 1 medium has an equivalent → **fold** into one `LocalRelease`.

No "majority" clause — flat `≥2` at every box size (a 9-medium box with only 2 confirmed equivalents still dissolves; the rest render as box-disc rows, which beats folding 9 discs to hide 2 known editions).

## 4. Division of labour

`index` never folds. Delete `index::db::plan_disc_merges` + `ensure_merged_local_release`. Keep `get_local_release_members` lookup ahead of `build_group_key` (so a sync-side fold survives re-scan).

`sync` decides everything — binding, medium assignment, fold/dissolve, equivalence.

## 5. Binding and scoring (sync)

1. Bind folder → release + medium position. Tags agree with MB → free. Tags don't (all `discNumber=1`) → `boxset::plan_box_bind` tracklist matcher decides (kept as-is, 7 existing tests kept).
2. Score `check_release_status` against **the medium's** tracks (`discNumber = mediumPosition`), not the whole release's. Fixes bulk of `MISSING_TRACKS` false positives on multi-medium releases.
3. Equivalence, three tiers, each only run on what the previous left unlinked:

### Tier 1 — exact recording-set equality (`box_editions::link_by_recording_fingerprint`, `box_editions.rs:43`)

- `medium_fp` CTE: source side filtered to `parent.mediumCount > 1`. **Target side: no `mediumCount` filter** — target can be multi-medium too (box-of-compilations case, e.g. a box reprinting another multi-disc compilation's own editions). Compute fingerprint per `(releaseId, position)` symmetrically on both sides. Write `equivalentReleaseId` + `equivalentMediumPosition` (`NULL` if target single-medium).
- **No `≥3`-track floor.** Exact recording-ID equality has zero coincidence risk at any track count (unlike title+duration matching) — a floor here permanently blocks every "singles box" (2-track-per-disc reissues) from ever dissolving. Only requirement: `recordingId IS NOT NULL` on every track, both sides.
- Multiple single-medium releases can share one fingerprint (reissues under different catalogue numbers) — harmless for card grouping (same `releaseGroupId`), but pick deterministically: lowest MBID, or a release the artist's other local rows already reference. Never "whatever order Postgres returns."

### Tier 2 — artist-scoped title+duration positional fallback

For releases synced before `recordingId` existed. Unchanged. Ambiguous → leave unset.

### Tier 3 — containment match

Fixes: box uses a bonus-track edition MB hasn't also catalogued as a standalone release (tier 1 equality then never fires).

- Only runs on a medium tiers 1–2 left unlinked, whose track count exceeds any exact candidate, **and whose `medium.title` is non-null/non-empty** — a null title has nothing to narrow against; skip outright rather than search with an empty pattern.
- Candidate scope: same artist via **`MusicBrainzReleaseArtist.artistId` join, never an artist-credit string match** (a joint work can carry different credit text across releases that still resolve to the same `Artist.id`).
- Candidate title filter: **substring containment either direction** on `owned::normalize_title` output (medium title contains candidate title, or vice versa) — not equality. Regardless of `releaseGroupSecondaryTypes`.
- Confirm via reused `owned::find_owning_bundle` (medium's tracks = the bundle, candidate's tracks = `mb_tracks`) — already implements "bundle contains every track of candidate, allowing extras," ≥3-track floor and duration tolerance already built in and tested. No new matching logic.
- >1 candidate satisfies containment → tie-break by preferring `releaseGroupSecondaryTypes = []`. Still >1 → leave unset.

4. Branch per release (only once `mediumCount > 1`):

- **Fold** (0–1 equivalent): merge sibling `LocalRelease` rows into one. Write one `LocalReleaseMember` per absorbed folder (`folderPath`, `discNumber` = medium position). Stamp `LocalReleaseTrack.discNumber` from medium position. Survivor: `mediumPosition = NULL`, `groupKey = "folder:{commonAncestor}"` (**never** `"mbrelease:{id}"` — collides when two local copies of one box/album both plan the same key; folder-derived stays unique per copy, which is what `./audit --duplicate-release` expects), `matchStatus = 'UNKNOWN'`.
- **Dissolve** (≥2 equivalents): per disc — has `equivalentReleaseId` → bind `releaseId` = that release, `mediumPosition` = its `equivalentMediumPosition` (may be non-NULL if target itself multi-medium), record `boxReleaseId`/`boxMediumPosition`. No equivalent (rarities disc, or below tier-3's title/floor gates) → bind `releaseId` = the box itself, `mediumPosition = N`, no provenance columns.
- **Partial ownership**: matcher binds whichever sibling folders exist independently; a missing medium is an open coverage gap (§6), not papered over.

## 6. Coverage (mandatory — downloader regression otherwise)

`get_covered_release_group_ids` (`scripts/sync/src/db.rs:978`) needs a third branch: a release counts covered when **every audio medium** is covered — bound at that `mediumPosition`, OR has an `equivalentReleaseId` that itself has a bind, OR has a `LocalRelease` with `boxReleaseId = this release` at matching `boxMediumPosition`. Without this a dissolved box has no bind on its own RG → reads MISSING → re-downloaded in full.

## 7. Backtrace (disc → wrapping box)

- Owned copy: `LocalRelease.boxReleaseId`/`boxMediumPosition` (already set by dissolve).
- Catalogue fact (no ownership needed): reverse query `MusicBrainzReleaseMedium WHERE equivalentReleaseGroupId = $rgId` (already indexed). Render as an "Also part of: {box title} ({year})" chip on the standalone card.

## 8. Web

- Delete `buildBoxEditionCards` + its tests (`releaseAggregation.ts:200`) and its ghost cards (`hasLocal:false`, `trackCount:0`). A dissolved disc is now a real bound `LocalRelease` → flows through `buildReleaseCard` → lands in its album's edition group via existing `releaseGroupId` grouper, no special-casing.
- Card with `boxReleaseId` set: edition label = box title, subtitle shows box disc position (`boxMediumPosition`) e.g. "disc 3 of 9".
- Rarities/no-equivalent box disc: own row, title `"{box title} — {medium title}"`, box year, real MB type, `Box Set` marker pill.
- Marker-pill tones already assigned elsewhere: amber = `EditionsPill`, red = MISSING. Use `info`/violet for both `DiscsPill` and the `Box Set` pill (`markerPill()` in `helpers/ui.ts`).
- `DiscsPill` (folded multi-disc, `discCount = mediumCount`) never renders on a dissolved box's disc rows.
- **Disc numbers always renumbered sequentially for display** (`ROW_NUMBER() OVER (ORDER BY position)` or client-side re-index) — MB's native `position` has gaps whenever a box interleaves audio with video media (`audio_media()` already filters video out but deliberately does not renumber, per `flatten_audio_tracks`'s own contract) — never show raw gapped position.
- `UnifiedRelease.boxParent: { releaseId, title, mediumPosition, mediumTitle } | null`, populated from provenance columns; keeps `discCount: number | null`.
- "Also part of" chip: §7.

## 9. What is deleted vs kept

Delete: `scripts/sync/src/multi_disc.rs` + `--repair-multi-disc` dispatch + `--link-box-editions` CLI mode (runs scoped at sync tail instead) + `boxset::apply_box_bind`'s fold behaviour + `index::db::plan_disc_merges`/`ensure_merged_local_release` + `buildBoxEditionCards`+tests + CLAUDE.md's box-set bullet (rewrite per §12 step 6; `docs/box_sets.md` itself already removed, this file is the sole spec).

Keep as-is: `boxset::plan_box_bind` + its 7 tests, MB layer (`audio_media`, `MbMedia.title`/`track_count`, `MbRecordingRef`, `MbTrackRow.recording_id`, `sync_mb_media_for_release`, `upsert_mb_release_with_media`), `box_editions.rs` internals (with the tier-1/tier-3 changes in §5 above), the Prisma schema from `458f9ac7` plus §2's additions.

Preserve exactly (unrelated fixes bundled into `98ac101c`, do not touch): `web/server/api/downloads/acquire.post.ts` (replacesLocalReleaseId), `web/server/utils/acquireDedup.ts`, `web/components/artist/Releases.vue`, `web/composables/useArtistPage.ts`, `web/helpers/artistPageLogic.ts` (download-progress-bar keying).

**Do not `git revert` anything** — `98ac101c` bundles the box-set fold with the above unrelated fixes; a revert throws those away. Cleanup is a hand-written deletion commit.

## 10. Known limitations (do not "fix" without discussing — data/architecture ceilings, not bugs)

1. Disc below tier-3's ≥3-track floor (inherited from `find_owning_bundle`) never resolves its own identity — binds to the box as an unnamed extra instead of its real (short) name. Box-level verdict unaffected.
2. A medium containing two complete non-overlapping albums (no bonus tracks) satisfies containment for both simultaneously — `equivalentReleaseId` is scalar, second match overwrites first. Rare in practice (real "twofers" are almost always 2 separate media, each independently resolvable). Fix would need `equivalentReleaseId` → many-to-many; deferred.
3. A box with <2 recognizable equivalents (nothing it contains was ever released standalone) correctly folds rather than "being recognized as a box" — this is by design, not a gap; goal 1 is still met by the one card.
4. Some boxes have **no per-medium titles at all** (chronological "complete sessions" reissues) — tier 3 cannot run (nothing to narrow with), and disc boundaries in these sometimes don't align with any original album's boundary at all (one CD can span material from 2+ different original releases). Correctly folds. Most common real-world box shape overall — expect this outcome often, not as an anomaly.
5. A fully-titled box can still fail to resolve a medium when remastering re-splits the same work across a **different disc count and different bonus-track selection** than any standalone edition — no tier attempts a many-media-to-many-media (sum-of-a-run) comparison. Deferred, same reasoning as #2.
6. A box-exclusive disc with a real, meaningful title (e.g. a previously-unreleased "lost album") and a true rarities/leftovers disc are indistinguishable in MB's data model once neither has a standalone equivalent — both render identically as `"{box} — {medium}"`. Not fixable without guessing intent MB doesn't encode.

**Separately, out of scope for this work entirely**: `scripts/common/src/tags.rs:58` writes the release-scoped **track** MBID into `ItemKey::MusicBrainzRecordingId`, so `./sync --only-write-mb-to-files` has been stamping the wrong kind of id into audio files (should be `recordingId`, not `musicbrainzId`). Real, pre-existing bug, unrelated blast radius — separate commit, not bundled into this rollout.

## 11. One-off repair (existing rows)

Not a permanent CLI flag. `./repair-box-sets` (repo root, bash — `scripts/scripts/` turned out to be root-owned/unwritable in the actual environment; a root-level wrapper matches `./backup`/`./restore`'s own convention anyway):

1. Scope: artists owning a `LocalRelease` bound to `mediumCount > 1`, plus artists in a sibling-folder group (same shape `boxset::find_sibling_groups` uses).
2. Reset scope (`matchStatus='UNKNOWN'`, clear `mediumPosition`/`boxReleaseId`/`boxMediumPosition`). No deletes at all in this script — a fold's `LocalReleaseMember` undo row + `DELETE` happen inside `apply_fold`'s own transaction, run by `./sync` itself in step 3, not by this script.
3. `./sync --artist-ids <file>` over that scope — the *normal* sync path, which now folds/dissolves automatically at its tail (phase 4). Repair and steady-state are the same code.
4. Fold/dissolve narration comes from `./sync`'s own console output (`boxset::run_repair`'s per-group "-> fold"/"-> dissolve" lines) — this script only orchestrates scope + reset + the sync call, no reporting of its own.

**No `--dry-run`.** User takes `./backup` before running; that's the recovery path. **Resumable for free**: `./sync`'s own `syncRunHash` mechanism (already existed, unrelated to this rework) skips already-processed artists on a re-run after an interruption — re-running this exact script after a crash/reboot/Ctrl-C picks up where it left off. No new checkpoint mechanism needed. Existing index/sync lock (`common::lock`) already blocks a concurrent `./refresh`; turn off Settings → Library auto-scan too as belt-and-braces.

## 12. Rollout — strictly sequential, no parallel work

Normal `./refresh`/sync stays off through steps 2–4. Each step confirmed complete before the next starts.

**Timing**: prior comparable-scope run (3064+1664 groups) took 5 days, MB-rate-limit-bound not compute-bound. Budget **5–12 days for steps 2–4**. Steps 0/1/3/5 are code/schema/pure-SQL — minutes each.

0. Cleanup commit (§9). Verify: `cargo build --release`, `pnpm typecheck` clean, and diff-check against actual `git diff 84dc227f..HEAD -- scripts/ web/` (not from memory).
1. `./backup`. Make `20260907000000_box_sets` idempotent, add `20260908000000_multidisk`. Deploy. Verify `recordingId` exists, both migrations recorded. Nothing else can run before this.
2. Backfill: re-sync the ~4700 multi-medium releases only (`max(discNumber) > 1`), not all 120k. Run to completion. Confirm row counts before proceeding.
3. Derive equivalences over backfilled media (pure SQL, minutes).
4. `./backup`. Run one-off repair (§11) to completion. Confirm via §13 queries against real data (check ABBA, Beatles specifically) before re-enabling auto-scan / resuming `./refresh`.
5. Web (§8).
6. Docs: reduce `docs/box_sets.md` to a pointer at this file; update CLAUDE.md box-set bullet; `docs/scripts/index.md`, `docs/scripts/sync.md` (`--repair-multi-disc`/`--link-box-editions` removed from CLI docs).

## 13. Verification queries

```sql
-- box discs: bound release, status, medium position
SELECT lr."folderPath", mr.title AS bound_to, lr."matchStatus", lr."mediumPosition", lr."boxMediumPosition"
FROM "LocalRelease" lr LEFT JOIN "MusicBrainzRelease" mr ON mr.id = lr."releaseId"
WHERE lr."folderPath" LIKE '<artist>/%<box folder>%' ORDER BY lr."folderPath";

-- derived equivalences for one box
SELECT m.position, m.title, m."trackCount", m."equivalentReleaseGroupId", m."equivalentMediumPosition"
FROM "MusicBrainzReleaseMedium" m JOIN "MusicBrainzRelease" r ON r.id = m."releaseId"
WHERE r."musicbrainzId" = '<box mbid>' ORDER BY m.position;

-- folds: one row per plain multi-disc release + its members
SELECT lr.title, lr."groupKey", count(m.id) AS members
FROM "LocalRelease" lr JOIN "LocalReleaseMember" m ON m."localReleaseId" = lr.id
GROUP BY lr.id, lr.title, lr."groupKey" ORDER BY members DESC LIMIT 20;

-- regression: rows bound to a multi-medium release still MISSING_TRACKS
WITH multi AS (SELECT id FROM "MusicBrainzRelease" WHERE "mediumCount" > 1)
SELECT count(*) FROM "LocalRelease" lr JOIN multi ON multi.id = lr."releaseId"
WHERE lr."matchStatus" = 'MISSING_TRACKS';

-- concrete post-repair spot-check target (§12 step 4): both ABBA 9CD boxes
SELECT lr.id, lr.title, lr."matchStatus", lr."groupKey", lr."folderPath",
       (SELECT count(*) FROM "LocalReleaseMember" m WHERE m."localReleaseId" = lr.id) AS members,
       (SELECT count(*) FROM "LocalReleaseTrack" t WHERE t."localReleaseId" = lr.id) AS tracks
FROM "LocalRelease" lr WHERE lr."folderPath" LIKE 'ABBA/%(9CD)%';
-- expect: shape (b) "The Albums" 8 rows COMPLETE unchanged + Bonus Tracks dissolved to the box;
-- shape (a) "The Complete Studio Recordings" 9 rows rebound from box to their standalone albums.
```

## 14. Task checklist

### Phase 0 — cleanup
- [ ] Delete per §9's delete-list; verify against real `git diff`, not memory
- [ ] `cargo build --release` + `pnpm typecheck` clean
- [ ] Preserve §9's "preserve exactly" list untouched

### Phase 1 — schema
- [ ] Idempotent `20260907000000_box_sets`
- [ ] New `20260908000000_multidisk`: §2's fields
- [ ] `pnpm prisma generate`, confirm no drift, never `db push`

### Phase 2 — index stops folding
- [ ] Delete `plan_disc_merges` + `ensure_merged_local_release` + their tests
- [ ] Keep `get_local_release_members` lookup ahead of `build_group_key`

### Phase 3 — sync: medium binding + equivalence
- [ ] Thread `mediumPosition` through bind path
- [ ] `check_release_status` scoped to one medium when `mediumPosition` set
- [ ] Tier 1: drop target `mediumCount=1` filter, drop ≥3-track floor, write `equivalentMediumPosition`, deterministic tie-break
- [ ] Persist `releaseGroupSecondaryTypes` at bind time (already-fetched data, no new API call)
- [ ] Tier 3: null-title skip; `MusicBrainzReleaseArtist`-join scoping (not credit-string); substring-containment title narrowing; `find_owning_bundle` reuse; secondary-types tie-break
- [ ] Tests: medium-scoped scoring; single-medium never enters equivalence; tier-1 multi-medium-target fixture; tier-1 2-track-medium fixture (regression guard for floor removal); tier-3 bonus-track containment fixture; tier-3 substring-title fixture; tier-3 cross-credit-string fixture; tier-3 type tie-break; tier-3 null-title no-op; tier-1 deterministic tie-break

### Phase 4 — fold vs dissolve
- [ ] Fold branch: merge, `LocalReleaseMember` undo rows, folder-derived `groupKey`
- [ ] Dissolve branch: bind to `equivalentReleaseId`/`equivalentMediumPosition` + provenance, or box + position
- [ ] Delete `multi_disc.rs` + `--repair-multi-disc` dispatch; move `--link-box-editions` to scoped sync-tail step
- [ ] Tests: fold at 0–1 equivalent, dissolve at ≥2 regardless of total media count, two-copies-of-one-box no `groupKey` collision, partial ownership binds independently

### Phase 5 — coverage
- [ ] Third branch in `get_covered_release_group_ids` (§6)
- [ ] Test: dissolved box's RG reads covered; genuinely-missing box does not

### Phase 6 — one-off repair script
- [x] §11: `./repair-box-sets` — scope/reset/`./sync --artist-ids`, no dry-run, resumable via `./sync`'s existing `syncRunHash` (no new checkpoint mechanism needed)

### Phase 7 — web
- [x] Delete `buildBoxEditionCards`+tests
- [x] `boxParent` from provenance columns; edition label = box title
- [x] Rarities row + `Box Set` pill
- [x] `DiscsPill` fold-only
- [x] "Also part of" chip (§7)
- [x] Disc-number renumbering at render time
- [x] Tests incl. renumbering fixture (gapped position → sequential display)

### Phase 8 — docs
- [x] `docs/box_sets.md` already removed (Phase 0) - remaining stale references repointed to this file
- [x] CLAUDE.md box-set bullet rewritten; obsolete `--repair-multi-disc`/`--link-box-editions` CLI lines removed; `./repair-box-sets` documented
- [x] `docs/scripts/index.md`, `docs/scripts/sync.md` rewritten (flags table, Box Sets section)

### Phase 9 — rollout
- [ ] Per §12, sequentially, with backup gates and completion confirmation at each step
- [ ] `cargo test`, `pnpm test:unit`, `pnpm test:e2e` (never bare `playwright test`) all green before Phase 9 starts
- [ ] User visual check post-rollout (no self-verification via login)
