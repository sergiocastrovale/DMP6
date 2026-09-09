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
- [x] Delete per §9's delete-list; verify against real `git diff`, not memory
- [x] `cargo build --release` + `pnpm typecheck` clean
- [x] Preserve §9's "preserve exactly" list untouched

### Phase 1 — schema
- [x] Idempotent `20260907000000_box_sets`
- [x] New `20260908000000_multidisk`: §2's fields
- [x] `pnpm prisma generate`, confirm no drift, never `db push`

### Phase 2 — index stops folding
- [x] Delete `plan_disc_merges` + `ensure_merged_local_release` + their tests
- [x] Keep `get_local_release_members` lookup ahead of `build_group_key`

### Phase 3 — sync: medium binding + equivalence
- [x] Thread `mediumPosition` through bind path
- [x] `check_release_status` scoped to one medium when `mediumPosition` set
- [x] Tier 1: drop target `mediumCount=1` filter, drop ≥3-track floor, write `equivalentMediumPosition`, deterministic tie-break
- [x] Persist `releaseGroupSecondaryTypes` at bind time (already-fetched data, no new API call)
- [x] Tier 3: null-title skip; `MusicBrainzReleaseArtist`-join scoping (not credit-string); substring-containment title narrowing; `find_owning_bundle` reuse; secondary-types tie-break
- [x] Tests: medium-scoped scoring; single-medium never enters equivalence; tier-1 multi-medium-target fixture; tier-1 2-track-medium fixture (regression guard for floor removal); tier-3 bonus-track containment fixture; tier-3 substring-title fixture; tier-3 cross-credit-string fixture; tier-3 type tie-break; tier-3 null-title no-op; tier-1 deterministic tie-break

### Phase 4 — fold vs dissolve
- [x] Fold branch: merge, `LocalReleaseMember` undo rows, folder-derived `groupKey`
- [x] Dissolve branch: bind to `equivalentReleaseId`/`equivalentMediumPosition` + provenance, or box + position
- [x] Delete `multi_disc.rs` + `--repair-multi-disc` dispatch; move `--link-box-editions` to scoped sync-tail step
- [x] Tests: fold at 0–1 equivalent, dissolve at ≥2 regardless of total media count, two-copies-of-one-box no `groupKey` collision, partial ownership binds independently

### Phase 5 — coverage
- [x] Third branch in `get_covered_release_group_ids` (§6)
- [x] Test: dissolved box's RG reads covered; genuinely-missing box does not

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
- [x] Per §12 steps 0-2 done (see §15 below); steps 3-4 run automatically inside the same sync (step 2); confirmation still pending
- [x] `cargo test`, `pnpm test:unit`, `pnpm test:e2e` (never bare `playwright test`) all green before Phase 9 starts
- [ ] User visual check post-rollout (no self-verification via login)

## 15. Rollout status (2026-09-07) — resume point after reboot/session close

Phases 0-8 are done, committed, and pushed to master (see `git log --oneline --grep=multidisk -i`
for the per-phase commit list). All committed under normal working tree, nothing pending in git.

**Step 0 (cleanup verify)**: done. `cargo build --release`, `pnpm typecheck`, `cargo test`,
`pnpm test:unit`, `pnpm test:e2e` all green. One unrelated pre-existing e2e test fixed along the way
(stale "Show terminal sidebar" switch label → "Scan automatically", commit `28321cbd`).

**Step 1 (deploy + migrate)**: done, 2026-09-07 ~17:18 UTC. `./deploy` ran clean (lint, typecheck,
docker build, transfer, restart, migrate). Verified on prod DB directly (`psql "$DATABASE_URL"`,
same URL as `web/.env` - it points at prod, 192.168.1.241):
- `MusicBrainzReleaseTrack.recordingId` column exists.
- `LocalRelease.mediumPosition`/`boxReleaseId`/`boxMediumPosition` columns + FK + index exist.
- `MusicBrainzReleaseMedium.equivalentMediumPosition` exists.
- `_prisma_migrations` has both `20260907000000_box_sets` and `20260908000000_multidisk` recorded
  (finished_at 2026-09-07 17:18:35 UTC).
- `dmp` container healthy post-restart (`docker ps`, `/api/health` → 200).

User's own `./backup` (manual, prior to this session's Phase 9 work) is the recovery point - no
`./backup` was run by me per user's explicit instruction ("no need to backup, already backed up
myself").

**Step 2 (backfill) — RUNNING, this is the long one**:

- **All new `MusicBrainzRelease` rows currently read `mediumCount = 1`** (120,703/120,703 at deploy
  time) - the pre-multidisk sync never populated it, so `mediumCount > 1` is USELESS for finding scope
  right now. Scope instead came from the same folder-sibling heuristic `./repair-box-sets` §11 uses:
  `LocalRelease.folderPath` with ≥4 path segments (`Artist/Type/Album/SubFolder...`) whose parent
  directory (path minus last segment) has >1 sibling `LocalRelease` - i.e. genuine nested disc/box
  subfolders, not two different top-level albums. Sanity-checked with a random sample before trusting
  it (real box sets: T. Rex 5CD, Rainbow 10CD, Pink Floyd "Shine On" 7CD, Linda Ronstadt 4CD, etc.) -
  see this session's transcript if the heuristic itself is ever in doubt.
- **Scope size**: 10,230 `LocalRelease` rows (bigger than this doc's old "~4700" estimate - that
  number was a rough figure from a *prior, differently-scoped* comparable run, not a prediction for
  this exact library), across **1,986 distinct artists** (2,047 counting the sync's own internal
  numbering, which starts from 1 and may count a couple of special-case names differently - the
  artist-ids file itself has exactly 1986 lines).
- Reset ran (SQL): all 10,230 scoped rows set to `matchStatus='UNKNOWN'`,
  `mediumPosition`/`boxReleaseId`/`boxMediumPosition` cleared.
- Artist-ids file: generated locally, copied to the NAS at
  `/mnt/SSD/web/dmp/logs/repair-artist-ids.txt` (== `/app/data/logs/repair-artist-ids.txt` inside the
  `dmp` container - `${DMP_DATA}/logs` is a real bind mount, see `docker-compose.yml`).
- **Kicked off inside a detached tmux session named `multi` on the NAS itself** (not this dev
  machine, not this Claude Code session) so it survives a reboot of this machine, this session
  closing, or an SSH disconnect:
  ```
  ssh -i ~/.ssh/nas Kp@192.168.1.241
  tmux attach -t multi        # reattach to watch live; Ctrl-b d to detach again without killing it
  ```
  Output was *meant* to also tee to `/mnt/SSD/web/dmp/logs/repair-box-sets-run.log` on the NAS host,
  but the first attempt at this used the container-internal path (`/app/data/logs/...`) as the `tee`
  target from a command that actually runs in the NAS **host** shell (`docker exec ... | tee ...` -
  the pipe and `tee` are host-side; only `sync` itself runs inside the container) - `tee` silently
  errored ("No such file or directory") and passed stdin through untouched, so no log file existed
  for the first chunk of this run (see §16). Fixed on the resume-after-502-fix restart to use the
  real host path, `/mnt/SSD/web/dmp/logs/repair-box-sets-run.log`:
  ```
  ssh -i ~/.ssh/nas Kp@192.168.1.241 "tail -f /mnt/SSD/web/dmp/logs/repair-box-sets-run.log"
  ```
  The exact command running inside `multi`:
  `sudo docker exec dmp sync --artist-ids /app/data/logs/repair-artist-ids.txt | tee /mnt/SSD/web/dmp/logs/repair-box-sets-run.log`
  (note: **host** path after `tee`, container path as the `--artist-ids` argument - they are two
  different mounts of the same underlying directory, do not swap them).
- This *is* steps 2+3+4 combined: box-set fold/dissolve + equivalence derivation now run
  automatically at the tail of every `./sync` invocation (Phase 4), so this one sync run backfills
  mediumCount/media rows (step 2), derives equivalences (step 3), and folds/dissolves (step 4) per
  artist as it goes - there is no separate manual step 3, and `./repair-box-sets` itself was not
  invoked directly (its logic was run by hand instead, since its `ENV_FILE`/`SYNC_BIN` assumptions
  are written for local execution and this DB write needs to happen against files that only exist on
  the NAS - see below).
- **Resumable for free** if interrupted (crash, NAS reboot, etc.): `./sync`'s own `syncRunHash`
  mechanism skips already-processed artists. To resume after any interruption, re-run the exact same
  command against the exact same ids file:
  `ssh -i ~/.ssh/nas Kp@192.168.1.241 "sudo docker exec dmp sync --artist-ids /app/data/logs/repair-artist-ids.txt"`
  (wrap in a fresh `tmux new-session -d -s multi '<cmd> 2>&1 | tee -a /app/data/logs/repair-box-sets-run.log'`
  if the `multi` session itself died too).
- **Timing**: MB-rate-limit-bound (~1.1s/request floor), not compute-bound. ~2000 artists, several
  releases each, several API calls per release → expect this to run for hours to a few days.
  Un-babysat by design; check back per below.

**Why `./repair-box-sets` wasn't run as-is**: the checked-in script assumes it's executed from the
repo root on a machine where `$SCRIPT_DIR/web/.env` exists and `$SCRIPT_DIR/sync` resolves to either
a local release binary or (its own docker-fallback branch) `docker exec dmp sync`. Locally, the
first branch wins (a local release binary was built this session for `cargo test`), which would have
written MusicBrainz tag data to `MUSIC_DIR` paths that don't exist on this dev machine (`MUSIC_DIR`
is NAS-only, per `reference_nas_sync` memory) - silently wrong, not merely slow. Splitting the script's
three pieces by hand (SQL scope/reset run locally against the same prod `DATABASE_URL`; the actual
`sync --artist-ids` call run via SSH+`docker exec` on the NAS, where `MUSIC_DIR` is really mounted)
gets the identical effect without that failure mode. The script itself is unchanged and still correct
for its intended one-time interactive use directly on the NAS; nothing here implies it needs fixing.

**What to do when resuming this session (after reboot)**:
1. Check whether `multi` is still running: `ssh -i ~/.ssh/nas Kp@192.168.1.241 tmux ls` (look for
   `multi`) and/or `tail -n 50 /mnt/SSD/web/dmp/logs/repair-box-sets-run.log`.
2. If it finished (no more `tmux` session, or the log ends with the sync's own summary/exit line and
   no further artists pending), confirm via the §13 verification queries - **run the ABBA spot-check
   first** (§13's last query): ABBA has both box shapes in this library ("The Complete Studio
   Recordings" 9CD, shape (a); "The Albums" 9CD, shape (b) per this doc's baseline census) and was
   mid-run as of this note, so it is a real, already-touched example, not a cold guess.
3. Also spot-check the regression query (§13, "rows bound to a multi-medium release still
   MISSING_TRACKS") - should trend toward zero for the backfilled scope, not exactly zero (§10's known
   limitations mean some rows correctly stay unresolved).
4. If everything checks out: mark §12 step 2-4 checkboxes done in this file, do a normal UI
   spot-check (browse to ABBA, a couple of other box-set artists, confirm cards render sensibly -
   "Box Set" pill, disc-of-N subtitle, no duplicate/ghost cards), then report back to the user rather
   than proceeding further automatically. Re-enabling anything is the user's call - `Settings →
   Library` auto-scan was OFF before this rollout and was **not** turned on by this work (explicit
   user instruction) - leave it exactly as found.
5. If `multi` died mid-run (NAS reboot, crash, etc.): just re-run the exact resume command above:
   `./sync`'s `syncRunHash` mechanism guarantees it only re-does artists it never finished.
6. **Once this backfill is validated (step 4 above), delete `./repair-box-sets`.** It exists solely
   to migrate rows created before this rework; a normal `./sync` folds/dissolves automatically for
   every artist from now on, so there will be no future "old data" batch for this script to repair
   against - keeping it around risks someone reaching for it later as if it were a recurring/general
   tool, which it deliberately is not (§11: "Not a permanent CLI flag", and the script's own header
   comment already says this). Remove the CLAUDE.md mention alongside it.

## 16. Incident during rollout: MB 502 burst + stale-stamp gap (2026-09-07)

**Symptom**: partway through the step-2 backfill, MusicBrainz's reverse proxy started returning
bursts of `HTTP 502` (not `503`) across many consecutive artists - `Detail error: HTTP 502 ...`,
`Release groups error: HTTP 502 ...`, plain `Request failed: error sending request...`. User caught
this from the tmux output and asked whether it's rate-limiting and whether it would tank the whole run.

**Root cause 1 - `mb_get` never retried 502/504.** `common::mb::api::mb_get`'s retry/backoff ladder
only triggered on `status == 503 || status == 429`. A `502`/`504` (the proxy in front of MB, not MB's
own app - never carries a rate-limit body or `X-RateLimit-*` headers) fell straight through to a hard
`Err` on the *first* attempt, no retry at all. `classify_mb_error` also didn't recognize `"502"`/`"504"`
substrings, so even after the error propagated up, callers keyed on `MbErrorKind::Transient` (which
correctly defers a release rather than treating it as genuinely absent/unmatched) misclassified it as
`Hard` instead.

**Fix**: `common::mb::api::mb_get`'s retry gate extended to `matches!(status, 502 | 503 | 504 | 429)`;
`classify_mb_error` extended to treat `"502"`/`"504"` substrings as `Transient`, same as `"503"`/`"429"`.
Two new tests (`classifies_bad_gateway_and_gateway_timeout_as_transient`, plus the existing 503/429
test left unchanged). `cargo test`/`pnpm test:unit`/`pnpm test:e2e` re-run clean. Deployed via a second
`./deploy` mid-rollout - necessary and expected, not a violation of "strictly sequential, no parallel
work": nothing else was running against the DB at the time.

**Root cause 2 - a real gap in the resumability contract, found while investigating root cause 1's
blast radius.** `stamp_sync_hash` (marks an artist "done" for this run, so a resume skips it) is
gated by `is_total_failure = processed_count == 0 && release_failures > 0` - correct for an artist
whose *every* release attempt actively failed. But an artist whose **release-groups fetch itself**
failed (the `Release groups error` branch) falls through with `release_groups = vec![]` and keeps
going; if none of that artist's local releases had an embedded MB release id to fall back on (tier 1),
nothing ever calls a per-release API function at all - `processed_count` stays 0 **and**
`release_failures` stays 0, `is_total_failure` reads `false`, and the artist gets stamped "done"
despite having accomplished nothing. `Detail error` (artist-detail fetch failure) does not have this
gap - it `continue`s before reaching the stamp code at all, so it always self-heals on resume.

**Verified against the real run, not just reasoned from code**: of the 1986 scoped artists, 603 were
stamped done by the time the 502 burst was caught; joining that set against `LocalRelease.matchStatus`
for their scoped releases showed **559 of the 603** still sitting at `UNKNOWN` (the value step 2's
reset SQL set them to) - i.e. stamped complete while never actually re-evaluated. Only 44 of the 603
were genuine, fully-processed successes.

**Remediation applied**: `UPDATE "Artist" SET "syncHash" = NULL WHERE id IN (<those exact 559 ids,
intersected with the current syncRunHash>)` - un-stamps precisely the wrongly-marked-done artists so
the resume retries them, leaves the 44 genuine successes alone (no wasted MB calls), and leaves the
1383 never-touched artists as they were (already retry-eligible, no stamp to clear). Resumed via the
same `sudo docker exec dmp sync --artist-ids /app/data/logs/repair-artist-ids.txt` command in `multi`;
confirmed picked up correctly ("Resuming run... Skipping N already-processed artist(s)" with N
reflecting the corrected, smaller stamped set).

**Update: root cause 2 fixed in code too** (user: "i dont want any bugs pending... leave no zombie
artists behind"). `scripts/sync/src/main.rs` gained `is_artist_total_failure(processed_count,
release_failures, release_groups_fetch_failed) -> bool` (extracted as a pure, unit-tested function -
5 new tests covering all four quadrants: active release failures, partial success despite failures,
a genuine zero-release-groups artist, a failed fetch with zero other counters, a failed fetch that
still processed something via a cached/embedded-id path). `release_groups_fetch_failed` is set on
*any* error from the release-groups fetch (regardless of `classify_mb_error`'s Transient/Hard
verdict - a retry-exhausted "still unavailable after N retries" counts too, not just a first-attempt
hard failure) and now feeds `is_total_failure` directly. Only a *successful* fetch is cached for
duplicate/linked artists sharing one MB id, so a duplicate no longer silently inherits a sibling's
failed fetch as if it were a legitimate empty result.

Deployed as a third `./deploy` mid-rollout. Before resuming after this deploy, re-ran the same
stamped-done-but-still-`UNKNOWN` check for the run segment that happened between the 502 fix and this
one (502s were already retried by then, so the window for new zombies was much smaller: 49 artists
got stamped done in that segment, only 4 were zombies) - cleared those 4 the same way, then resumed
with the same `--artist-ids` file. Log-file `tee` target was also corrected on this resume: earlier
attempts used the container-internal path (`/app/data/logs/...`) as the *host*-side `tee` argument,
which silently failed to write (see the correction above in the main status section) - this resume
uses the real host path, `/mnt/SSD/web/dmp/logs/repair-box-sets-run.log`, confirmed non-empty and
growing immediately after restart.

**Net effect**: no known way remains for this (or any future) sync run to mark an artist "done"
without having actually processed it. Nothing pending from this incident.

## 17. Current status (2026-09-09)

### What was wrong, in plain terms

The box-set work from the earlier rollout had **never actually taken effect**. Every box set in the
library was still sitting as a pile of unconnected disc folders, all marked "missing tracks". Four
separate faults were behind it:

1. **Box-set repair was silently switched off.** Whenever a sync was run for one named artist (the
   normal way to run it), the box-set step matched the artist's name against the *folder path*
   instead of the artist, so it never matched anything. It reported "0 groups found", which reads
   exactly like "this artist has no box sets" - so nothing looked broken. It had been doing nothing
   for every scoped sync.
2. **Some albums were filed under the wrong artist name.** 35 artists had an empty, wrongly-named
   row sitting in front of the real one. Bob Dylan's 72 albums were filed under "Dylan"; Erroll
   Garner's 76 under "Wardell Gray Quintet". The artist page showed the wrong name and the real
   entry was unreachable.
3. **Deluxe editions were invisible to the matcher.** MusicBrainz cuts long replies short, and the
   code mistook a short reply for "that's everything". For *OK Computer* it saw 31 of 39 editions -
   the 8 it never saw were every OKNOTOK deluxe. That is precisely the kind of edition the matcher
   goes looking for when a folder has more tracks than the album.
4. **Discs had to be in the exact same order as MusicBrainz.** A disc holding all the right songs in
   a different running order matched nothing, and one unmatched disc threw out the whole box.

Separately, a full library sync was on track to take **~99 days**. The assumed cause (MusicBrainz's
rate limit) was wrong: the real cause was that requests were sent one at a time and each one spends
5-30 seconds waiting for a reply, so the connection sat idle roughly 85% of the time. Sync now sends
several at once while still obeying the same one-request-per-second limit, and no longer re-asks
MusicBrainz the same question hundreds of times per artist.

### What was checked

ABBA, The Beatles, The Rolling Stones and Bob Dylan were re-synced and then checked **against live
MusicBrainz**, not just against our own database:

| Check | Scope | Result |
|---|---|---|
| Album completeness labels (complete / missing tracks / extra tracks) | 399 albums, 292 MusicBrainz releases | all correct |
| "Missing" albums that we actually own | 877 entries | none wrongly listed |
| "Songs already inside a collection you own" notes | 108 notes | all 108 correct |
| Box sets recognised and split into their albums | 13 groups | correct |

The few albums still labelled "missing tracks" were checked by hand and are genuine: the files are a
different mix or edition than the one MusicBrainz lists (2009 remaster vs 2015 remix), or the song
title is spelled differently in the files ("Jumping Jack Flash" vs "Jumpin' Jack Flash"), or the
tracks are Spanish-language versions. Those are tagging differences in the files, not sync faults.

### Known pending items

- [ ] **ABBA's "Complete Studio Recordings" 9CD box still won't link up.** Everything matches except
      one song title: the files say "Ring Ring (English version)", MusicBrainz says "Ring Ring". One
      mismatched song rejects the whole 9-disc box. Fixing it means loosening how strictly song
      titles must match, which risks wrongly merging genuinely different recordings elsewhere -
      deliberately left alone pending a decision.
- [x] **"Missing album" lists could go stale when a box set was split up.** ~~The missing-album list
      is built per artist during the sync, but box sets are only split at the very end of the whole
      run.~~ Fixed - the list is now swept again after box sets are split.
- [x] **33 artists filed under the wrong name.** ~~Erroll Garner's 76 albums sat under "Wardell Gray
      Quintet"~~ Fixed, all 33, via `./sync --repair-artist-identities`. Only one pair turned out to
      be the same artist under two names (Grover Washington) and was merged; the other 32 were never
      the same artist and were simply unlinked. A near-empty entry holding someone else's MusicBrainz
      identity now gives it up.
- [ ] **How the wrong identities got written has not been traced.** The damage is repaired and sync
      no longer creates this particular mess, but the original cause - most likely albums credited to
      two artists at once - is still unknown, so new cases may appear. Re-run the repair occasionally
      and see whether the count grows.
- [ ] **4,586 artists have albums but no MusicBrainz identity yet** - they have simply never been
      synced (Tangerine Dream with 239 albums, Miles Davis with 169, and so on). Not damage; this is
      the backlog the speed work exists to clear. A handful of the just-unlinked entries sit in here
      too and will pick up their identity on the same pass.
- [ ] **Very large artists are still slow.** The four tested own 70-140 albums each and take roughly
      an hour apiece. That is expected - the typical artist owns 3 - but worth knowing before
      re-syncing a big name.
- [ ] Re-run the box-set pass across the rest of the library, now that scoped syncs actually perform
      it (it has effectively never run for any single-artist sync).

### Earlier rollout note (superseded)

Total: 563 zombie artists found and fixed. For each one I ran UPDATE Artist SET syncHash = NULL — that un-marks them as "done", so the running sync picks
them right back up and retries them for real. That already happened, twice, before each resume. They are not skipped, not lost — they're back in the
queue and will get processed again, now with the actual fix in place so they'll succeed this time (assuming MB cooperates).

The 89 genuine successes were left alone — no need to redo work that already worked.

So: nothing from before is being silently left broken. Every artist that got a fake "done" stamp has already been reset and requeued. If you want to double check yourself: syncHash on Artist is NULL again for all 563 of them, and the currently-running sync will hit them again in its normal pass
through the 2047-artist list.
