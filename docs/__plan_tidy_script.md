# Plan: `./tidy` — library-wide repair split out of `./sync`

Status: **implemented and rolled out** (built 2026-09-12/13, first whole-library run 2026-09-17,
Step 7's one-off run 2026-09-18). Kept as design history only — current behaviour is in
`docs/scripts/tidy.md`, and what the rollout found and fixed afterwards is in
`docs/scripts/tidy_observations.md`. Do not execute these steps again.

## Context

A plain `./sync` today only visits "pending" artists, and it runs library-wide repairs at its tail
(`scripts/sync/src/main.rs:2522-2629`).

The box-set pass (`boxset::run_repair`, main.rs:2580) sets `matchStatus='UNKNOWN'` on every disc it
folds or dissolves (`boxset.rs` `apply_fold` ~817, `apply_dissolve` ~897/917). Only the *next* sync
re-scores those discs:
- `db::get_artists_pending_sync` (db.rs:1378) has an UNKNOWN clause that re-picks the artist.
- Re-scoring is a network re-match (main.rs:1618-2110).

So operators run sync twice. Other repairs hide behind standalone flags: `--repair-artist-identities`,
`--repair-shared-release-ids`, `--recompute-scores`, `--repair-recording-tags`.

**Goal:**
- `./sync` does per-artist matching only.
- New `./tidy` does every library-wide repair and reorganize step, and finishes in ONE run.
- Every caller chains `./tidy` after `./sync`.
- Tidy picks its work from a DB watermark, so a missed or interrupted tidy fixes itself on the next run.
- The recording-tags repair becomes a throwaway Python script outside `scripts/`.

## Decisions (user-approved)

1. **Separate binary** `./tidy`, own crate `scripts/tidy`, doc `docs/scripts/tidy.md` (style of
   `docs/scripts/refresh.md` / `sync.md`).
2. **Watermark** `Artist.lastTidiedAt DateTime?`.
   - Plain `./tidy` processes artists where
     `lastSyncedAt IS NOT NULL AND (lastTidiedAt IS NULL OR lastSyncedAt > lastTidiedAt)`.
   - Stamp `lastTidiedAt = <tidy start time>` (not NOW) for processed artists, only if the run was not
     interrupted and no phase errored. An artist re-synced during tidy stays pending.
3. **Every caller chains tidy** (UI, `./refresh`, auto-scan). Sync never calls tidy.
4. **Recording-tags is a one-off Python script** in top-level `oneoff/` (NOT `scripts/`). Delete it after
   the run. The Rust flag and code are removed.

## Verified facts to build on

### Sync tail (main.rs:2501-2635)
1. Wait for image tasks.
2. `cleanup_scope` (2525).
3. `delete_empty_local_releases` (2532).
4. `delete_orphaned_mb_releases` (2540). **Must run before** `db::retire_owned_missing_placeholders`
   (2545, always global).
5. `boxset::run_repair(pool, http, limiter, reporter, only, exact)` (2580). Contains an `--only`
   name-substring hack for `--release`.
6. Orphans + retire again (2613-2628). Copy the ordering comment at 2600-2612.
7. `update_statistics`, `clear_run_hash`, `release_lock`.

### Standalone sync flags (clap `SyncArgs` main.rs:40-120)
- **`--recompute-scores`** (464 → `db::recompute_all_completeness` db.rs:716, pure SQL, only touches
  `completeness`).
- **`--repair-artist-identities`** (488 → db.rs:996/1156/1218, passes A/B/C). Pure SQL, validated
  2026-09-10, idempotent.
- **`--repair-shared-release-ids`** (577 → repair.rs:167). **Obsolete:** the guard it paired with was
  removed (comment ~main.rs:2043) because shared releaseIds are now legitimate duplicate copies.
  Running it would unbind legitimate rows. **Delete it.**
- **`--repair-recording-tags`** (905 → `recording_tags.rs`).
- **Stay in sync:** `--catalogue-gaps` and `--only-write-mb-to-files` (per-artist network work).

### Module dependency graph
- `boxset.rs` uses `crate::box_editions`, `crate::db::*` (glob), `crate::mb_api::{self, RateLimiter}`,
  `crate::owned::{durations_compatible, normalize_title}`, `common::mb::types`, `common::progress`.
- `box_editions.rs` uses `crate::owned`.
- `status.rs` uses `crate::mb_types` + `common::types::TrackMeta`.
- `db.rs` (1733 lines) uses `crate::owned::LocalBundle`.
- `catalogue_gaps.rs` and `main.rs` use `owned::detect_containment`.
- **Conclusion:** moving to `common` would drag in all of db.rs. **Layout: `sync` becomes lib+bin.**

### Box pass internals
- `run_repair` (boxset.rs:972-1190) returns `BoxSetSummary` with counts only, no ids.
- `find_sibling_groups` (486) is a whole-table query grouping by parent folder. It also returns
  `artist_names`, used for name filtering.
- `persist_box_media` writes MusicBrainzRelease + media + tracks to the DB, so they exist for a DB-only
  re-score.
- **`apply_fold`:**
  - moves the siblings' `LocalReleaseTrack.localReleaseId` into one LocalRelease
  - sets `discNumber`
  - deletes the sibling LocalReleases
  - sets `releaseId = box`, `mediumPosition = NULL`, `matchStatus = 'UNKNOWN'`
  - writes `LocalReleaseMember` rows
  - **leaves `LocalReleaseTrack.mbTrackId` untouched** (stale links possible)
- **`apply_dissolve`:** sets `releaseId`, `mediumPosition`, `boxReleaseId`, `boxMediumPosition`,
  `matchStatus = 'UNKNOWN'`, only when something changed.

### Scoring
- `status::check_release_status(&[&TrackMeta], &[String] local_track_ids, &[(MbRelease, Vec<MbTrack>)], year, medium_position)`
  (status.rs:112) is **pure**. With exactly one candidate release, `is_confident` is always true
  (status.rs:144).
- Sync builds `local_metas: Vec<TrackMeta>` from `LocalTrackRow` at main.rs:~1872. Extract that into a
  shared fn.
- `get_local_tracks_for_release` (db.rs:1517) and `get_local_releases_for_artist` (db.rs:1448) already
  provide `medium_position` and `dissolved_bound_mb_id`.
- Writes after scoring:
  - `link_local_tracks_to_mb` (db.rs:657): sets `mbTrackId` only for matched tracks.
  - `update_local_release_match` (db.rs:611): sets `releaseId` + `matchStatus` only.
- `MbTrack` (common/src/mb/types.rs:84): id, title, position, length, disc_number, recording.
  `MbRelease` is at :48.
- The DB `MusicBrainzReleaseTrack` has title, position, discNumber, durationMs, musicbrainzId,
  recordingId, which is enough to rebuild `MbTrack`. The load query pattern is at db.rs:~301.
- `statusReason` is a MusicBrainzRelease column (gap/containment notes), not touched by a re-score.

### Watermark traps
- `db::update_artist_sync_stats` (db.rs:686) **stamps `lastSyncedAt`**. Tidy must NEVER call it,
  otherwise an artist stays pending forever.
- `common::totals::recompute_artist_completeness` only sets `completeness`, so it is safe.

### Lock
- `scripts/common/src/lock.rs`: `acquire_lock`, `release_lock`, `clear_stale_lock_minutes(10)`.
- **No heartbeat:** any binary starting after 10 minutes steals a live lock.
- `acquire_lock` callers:
  - `delete/src/main.rs:677`, `delete/src/release.rs:276`
  - `sync/src/main.rs:658`
  - `fix/src/main.rs:64`
  - `nuke/src/main.rs:702/809`
  - `index/src/main.rs:489`
  - `playlists/src/main.rs:867`
- `web/server/utils/scriptLock.ts` is an in-process promise mutex with no binary list. Only its comment
  mentions index/sync.

### Tag keys (lofty 0.24.0 `src/tag/item.rs`, used by the Python port)
- **Vorbis (FLAC/Ogg/Opus):** recording = `MUSICBRAINZ_TRACKID`, release-track =
  `MUSICBRAINZ_RELEASETRACKID` (lines 454-455).
- **MP4:** recording = `----:com.apple.iTunes:MusicBrainz Track Id`, release-track =
  `----:com.apple.iTunes:MusicBrainz Release Track Id` (339-340).
- **ID3 (MP3):** recording = UFID frame, owner `http://musicbrainz.org`. Release-track = TXXX
  `MusicBrainz Release Track Id` (252, special case at 251; see also `common::tags::MbSlots`
  tags.rs:186-302).
- **APE:** same keys as Vorbis (153-154). Relevant for `.aac` only if an APE tag is present. `.aac`
  normally carries ID3v2, so treat `.aac` like MP3 via `mutagen.id3.ID3`.
- **Library extensions** (`index/src/main.rs:41`, `common/src/images.rs:60`): mp3, m4a, opus, aac,
  ogg, flac.

### Web callers
- `web/components/settings/ScanActions.vue:20-36`: check/full use `terminal.runSequence`; sync uses
  `terminal.run`.
- `web/components/artist/ScanActions.vue:32-52`: check, rebuild, resync. Reindex has no sync.
- `web/components/ui/ButtonRefresh.vue:15-20`.
- `web/components/artist/Releases.vue:208` → `./refresh --release`.
- `web/components/dashboard/FirstScan.vue:22` → `./refresh`.
- `web/server/utils/autoScan.ts:54-80`: `runScript('index'|'sync')`.
- `web/stores/terminal.ts:97` `runSequence`: stop cancels the remaining steps. Acceptable, the watermark
  catches up.

### Allow-list, wrappers, build
- `web/server/utils/terminalCommand.ts`: `ALLOWED_COMMANDS`, `COMMAND_PERM`, `WEB_MODE_COMMANDS`,
  `DESTRUCTIVE_FLAGS` (contains `--repair-recording-tags`).
- Label map at `web/helpers/constants.ts:~106`.
- Root `./sync` wrapper pattern: release binary → cargo build → `docker exec dmp`.
- Root `./refresh` runs index then sync in two branches.
- `Dockerfile`: Cargo.toml COPY ~14-15, stub mkdir/echo ~29-33, src COPY ~51-52, binary COPY ~121-131.
- `deploy:58-59` has scp + chmod wrapper lists. Add `tidy` to both.
- Workspace members live in `scripts/Cargo.toml`.

### Existing tests touching this
- `web/test/server/utils/terminalCommand.test.ts`
- `web/test/server/utils/autoScan.test.ts:90` ("runs index then sync, in order")
- `web/test/stores/terminal.test.ts`
- `web/test/components/settings/ScanActions.test.ts`, `web/test/components/artist/ScanActions.test.ts`
- `web/test/components/ui/ButtonRefresh.ts`: **missing `.test` suffix, never run by vitest**
  (`vitest.config.ts:41` include). Boyscout: rename to `ButtonRefresh.test.ts`.
- `web/e2e/scan-actions.spec.ts:130-245`: asserts exact captured command sequences.
- `scripts/sync/tests/catalogue_smoke.rs`: scratch-DB integration pattern.

### NAS
- `ssh nas` as user Kp (uid 3000), which owns the music files, so `os.utime` works.
- Python 3.11.9, mutagen 1.47, psycopg2 installed.
- Music at `/mnt/dmp/music/mainstream` (the container sees `/music`).
- Postgres on host port 5432 (container `ix-postgres-postgres-1`). `DATABASE_URL` is in
  `/mnt/SSD/web/dmp/.env`.
- The old serial Rust recording-tags dry run reached 13960/45995 artists before its tmux died. Log at
  `/tmp/repair-dry-run.log`: "FŒHN would fix 8", "Elvis Presley would fix 1035".

## Step 1 — schema

- Migration `web/prisma/migrations/20260912000000_artist_last_tidied_at/migration.sql`:
  `ALTER TABLE "Artist" ADD COLUMN "lastTidiedAt" TIMESTAMP(3);`
- Add `lastTidiedAt DateTime?` to the Artist model in `web/prisma/schema.prisma` (next to
  `lastSyncedAt`).
- Never `db push`.
- No backfill: the first tidy is the whole library, which is intended (it is the box-set rollout).

## Step 2 — `sync` becomes lib + bin

- `scripts/sync/Cargo.toml`: add `[lib] name = "dmp_sync"`, `path = "src/lib.rs"`. The name avoids
  clashing with `std::sync`. Keep `[[bin]] sync`.
- New `scripts/sync/src/lib.rs`: `pub mod` for db, boxset, box_editions, status, owned, mb_api,
  mb_types, mb_matching, catalogue_gaps, images. Leave `nuke` in the binary if only main uses it.
- `main.rs`: replace the `mod …` lines with `use dmp_sync::{…}`.
- New shared fns in the lib:
  - `status::track_metas_from_rows(&[LocalTrackRow]) -> Vec<TrackMeta>`, extracted from main.rs:~1872.
    Sync uses it too.
  - `db::load_mb_release_with_tracks(pool, mb_release_db_id) -> Option<(MbRelease, Vec<MbTrack>, String musicbrainz_id)>`,
    built from MusicBrainzRelease + MusicBrainzReleaseMedium + MusicBrainzReleaseTrack.

## Step 3 — `scripts/tidy` crate

- **Cargo.toml deps:** `dmp_sync` (path `../sync`, package `sync`), common, sqlx, tokio, clap, reqwest,
  colored, chrono, dotenvy.
- **CLI:**
  - `--all` (ignore the watermark)
  - `--only <name>` / `--exact` / `--from` / `--to` (`common::filters::matches_filter`)
  - `--artist-ids <file>`
  - `--web`, `--verbose`
- **Setup:** load config/pool the way sync does. `clear_stale_lock_minutes(10)`, then
  `acquire_lock(pool, "tidy", pid, args)` with heartbeat (Step 5). Ctrl-C/SIGTERM release the lock
  (copy sync main.rs:663-689). `start = Utc::now()`. `running: AtomicBool`.
- **Pipeline, in order.** Each phase gets its own error boundary: log via
  `common::error_log::log_warn`, set `had_error`, continue.
  1. **Scope:** artist ids from the watermark query (or flags). Empty → print "Nothing to tidy", release
     the lock, exit 0.
  2. `delete_empty_local_releases(Some(scope))` (`--all` → `None`).
  3. `delete_orphaned_mb_releases(scope)`, then `retire_owned_missing_placeholders()`. **Order
     mandatory.**
  4. **Box pass by artist ids:**
     - `run_repair` takes `scope: Option<&[String]>` instead of `only`/`exact`.
     - New `find_sibling_groups` filter: keep whole groups whose parent contains ≥1 LocalRelease with a
       `LocalReleaseArtist` in scope (SQL `WHERE f.parent IN (SELECT parent … JOIN LocalReleaseArtist … = ANY($1))`).
       Siblings owned by other artists stay in the group.
     - Delete `group_matches_filter` and its name tests (replace with a scope test).
     - `BoxSetSummary` gains `touched_local_release_ids: Vec<String>`: pushed by `apply_fold` (the
       surviving id) and by `apply_dissolve` (each changed member).
     - Needs an HTTP client + a single `RateLimiter` (one schedule, never two, see CLAUDE.md
       `MB_MAX_INFLIGHT`).
  5. **DB-only re-score:** new `rescore_bound_release(pool, local_release_id) -> Rescore {Scored(status)|Deferred}`.
     - **Targets:** every LocalRelease with `matchStatus='UNKNOWN' AND releaseId IS NOT NULL` owned by a
       scoped artist, ∪ touched ids.
     - Load local tracks → `track_metas_from_rows`.
     - `load_mb_release_with_tracks(releaseId)`. None or zero tracks → `Deferred`: leave UNKNOWN, sync
       re-picks it via the UNKNOWN clause.
     - `check_release_status(refs, ids, &[(rel, tracks)], year, mediumPosition)`.
     - Link: map matched `MbTrack.id` → `MusicBrainzReleaseTrack.id` (same join as main.rs:~2060-2071),
       then `link_local_tracks_to_mb`.
     - **Also** `UPDATE "LocalReleaseTrack" SET "mbTrackId"=NULL WHERE "localReleaseId"=$1 AND id <> ALL($matched)`.
       A fold moves tracks with stale links.
     - `update_local_release_match(pool, id, releaseId, status_to_db_string(status))`.
     - No MB calls. No allow-list gate (already bound). No tag writes (the next sync's `write_mb_ids`
       owns tags). **Never** `update_artist_sync_stats`.
  6. `delete_orphaned_mb_releases(scope)`, then `retire_owned_missing_placeholders()` again. Dissolving
     makes release groups owned.
  7. **Artist identity repair:** `repair_all_empty_primaries(false)` → `repair_contradicted_identities`
     → `repair_shared_identities`, all global. Moved from the sync flag (keep the printing from
     main.rs:488-575).
  8. **Scores:**
     - `--all` → `recompute_all_completeness`.
     - Otherwise `common::totals::recompute_artist_completeness` for each scoped artist ∪ owners
       (`LocalReleaseArtist`) of touched/re-scored releases.
  9. `update_statistics`.
  10. If `running && !had_error`:
      `UPDATE "Artist" SET "lastTidiedAt"=$start WHERE id = ANY($scope)`. With `--all`, stamp every
      artist with `lastSyncedAt` not NULL. Release the lock.
- **Summary block** (Reporter, like sync main.rs:2642-2658): elapsed time, then one line per phase:
  - empty releases removed
  - orphans / placeholders retired (both rounds)
  - box groups seen / bound / folded / dissolved / key-taken / failed
  - re-scored (per status) / deferred
  - identity A/B/C
  - scores recomputed
  - artists stamped (or "NOT stamped: errors/interrupted")
- **Wiring:**
  - `scripts/Cargo.toml` members add `"tidy"`.
  - Root wrapper `./tidy`: clone `./sync`, binary `tidy`, docker fallback `dmp tidy`. `chmod +x`.
  - `Dockerfile`: 4 spots (tidy Cargo.toml COPY, stub `tidy/src/main.rs`, src COPY, binary COPY). The
    sync stub also needs `sync/src/lib.rs`.
  - `deploy:58-59`: add `$PROJECT_ROOT/tidy` to scp and `$NAS_DEPLOY_PATH/tidy` to chmod.

## Step 4 — strip sync

- Delete the main.rs tail block 2522-2629. Keep: image-task wait, `update_statistics`, run hash, lock
  release.
- Delete flags + code:
  - `--repair-artist-identities` (moved to tidy; the db fns stay in lib)
  - `--repair-shared-release-ids` + `repair.rs` (also drop `mb_matching::names_are_similar` if it has no
    other users)
  - `--recompute-scores` (fn stays, tidy uses it)
  - `--repair-recording-tags` + `recording_tags.rs`
  - `db::get_owned_track_paths_for_artist`, `get_recordings_for_release_track_ids`
  - `common::tags::{plan_recording_fix, apply_recording_fix, read_track_mb_ids, RecordingFix}` + their
    tests, after grepping for other callers
  - `--dry-run` if nothing else uses it
- **Keep** the `write_mb_ids` stale-recording self-heal (tags.rs:83-84): it is normal flow.
- Fix the flag conflict checks (main.rs:609-643).
- **Keep** the UNKNOWN clause in `get_artists_pending_sync`: index sets UNKNOWN on track deletion, and
  tidy defers rows.
- Remove the `boxset` import from main if unused.

## Step 5 — lock heartbeat (`common::lock`)

- `acquire_lock` returns `LockGuard`, which spawns a tokio task every 60s:
  `UPDATE "Statistics" SET "scanLockedAt"=NOW() WHERE id='main' AND "scanPid"=$pid`.
- `release_lock(pool)` stays. The guard's `Drop` aborts the task; callers keep the guard alive until
  release.
- Update all callers listed above (delete×2, sync, fix, nuke×2, index, playlists, tidy).
- The 10-min stale threshold then only fires on dead processes. Update the `scriptLock.ts` comment
  ("stale-lock auto-clear covers crashes" is still true).

## Step 6 — callers chain tidy

- **`web/components/settings/ScanActions.vue`:** check/full sequences append
  `{ command: './tidy', args: [] }`. `sync` becomes `runSequence([./sync, ./tidy])`.
- **`web/components/artist/ScanActions.vue`:** check, rebuild, resync append `./tidy` (plain, the
  watermark picks up the artist). Resync becomes a sequence. Reindex unchanged.
- **`web/components/ui/ButtonRefresh.vue`:** append `./tidy` to its sequence. Its `./refresh` path is
  covered by the wrapper.
- **Root `./refresh`:** `TIDY_BIN=$(resolve_bin tidy "$SCRIPT_DIR")`. After sync in both branches,
  run `"$TIDY_BIN"` and forward `--web` if present in `$@`. Only forward `--web`/`--verbose`.
  - Scoped branch: `"$SYNC_BIN" … && "$TIDY_BIN"`.
  - Unscoped: `"$INDEX_BIN" "$@" && "$SYNC_BIN" "$@" && "$TIDY_BIN" <web flags>`.
- **`web/server/utils/autoScan.ts`:** type `'index' | 'sync' | 'tidy'`. After sync,
  `await runScript('tidy')`. Log text "index + sync + tidy". Doc comment.
- **`web/server/utils/terminalCommand.ts`:**
  - add `'./tidy'` to `ALLOWED_COMMANDS`
  - `COMMAND_PERM['./tidy'] = 'sync.run'`
  - add to `WEB_MODE_COMMANDS`
  - remove `--repair-recording-tags` from `DESTRUCTIVE_FLAGS` and its comment
- **`web/helpers/constants.ts:~106`** label: `'./tidy': 'Tidying library…'`. `scanActions` subtexts:
  "Index new files, sync & tidy" / "Sync pending releases, then tidy".
- **`--web` progress:** tidy should emit the same `PROGRESS:{json}` phases via Reporter web mode that
  sync does (check `common::progress` for `set_web`).

## Step 7 — one-off Python: `oneoff/repair_recording_tags.py`

- **Location:** top-level `oneoff/`, outside `scripts/`, not deployed.
  `scp oneoff/repair_recording_tags.py nas:/mnt/SSD/web/dmp/oneoff/`.
- **Args:** `--env /mnt/SSD/web/dmp/.env` (parse `DATABASE_URL`; if the host isn't reachable use
  `localhost:5432`), `--music-dir /mnt/dmp/music/mainstream`, `--apply` (default dry-run),
  `--only <artist substring, case-insensitive>`, `--workers 8`, `--resume`.
- **Candidates:**
  `SELECT DISTINCT lrt."filePath" FROM "LocalReleaseTrack" lrt JOIN "LocalReleaseArtist" lra ON lra."localReleaseId"=lrt."localReleaseId" JOIN "Artist" a ON a.id=lra."artistId" [WHERE a.name ILIKE %s] ORDER BY 1`.
  Same set as the Rust version.
- **Read** (ThreadPoolExecutor), format by extension:
  - `mp3`/`aac`: `mutagen.id3.ID3(path)`. Recording = first `UFID` frame with
    `owner == "http://musicbrainz.org"` (`data.decode()`). Release-track = `TXXX:MusicBrainz Release Track Id`.
  - `flac`: `mutagen.flac.FLAC`. `ogg`/`opus`: `mutagen.File(path)` (OggVorbis/OggOpus). Keys
    `musicbrainz_trackid` / `musicbrainz_releasetrackid`, case-insensitive (Vorbis keys are).
  - `m4a`: `mutagen.mp4.MP4`. `----:com.apple.iTunes:MusicBrainz Track Id` /
    `----:com.apple.iTunes:MusicBrainz Release Track Id` (bytes values; `MP4FreeForm`).
  - Trim; empty → None. File missing → count `missing`. Exception → count `failed`, log.
- **Lookup:** gather recording values, batches of 1000:
  `SELECT "musicbrainzId", max("recordingId") FROM "MusicBrainzReleaseTrack" WHERE "musicbrainzId" = ANY(%s) GROUP BY 1`.
- **Plan** (mirrors `plan_recording_fix`):
  - value found with a recording → `replace`
  - found with NULL recording → `blank`
  - not found → `keep`
- **Apply** (only `--apply`):
  1. `st = os.stat`.
  2. Set/remove the recording slot. If the release-track slot is empty, set it to the old value.
  3. Save. ID3: `tags.save(path, v2_version=tags.version[1])` (keep 2.3 vs 2.4), and never delete
     other frames. MP4/Vorbis: `f.save()`.
  4. `os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns))`.
- **Output:**
  - progress `[n/N] replaced/blanked/failed` every 500 files
  - per-change CSV `oneoff/recording_tags_<YYYYmmdd-HHMM>.csv` (path, action, old, new) as the undo
    record
  - `--resume` checkpoint `oneoff/.recording_tags_done` (append processed paths, flush each batch)
  - final summary
- **No scan lock.** It only touches recording/release-track slots, mtimes are kept so index ignores
  the files, and a concurrent sync writes the same correct values.
- **Validate before the full run:**
  1. `python3 repair_recording_tags.py --only "FŒHN"` → expect 8 blank.
  2. `--only "Elvis Presley"` → expect ~1035.
  3. `--apply --only "FŒHN"`, then re-read with mutagen and confirm.
  4. Full run: `ssh nas`, `tmux new -s rectags`,
     `python3 /mnt/SSD/web/dmp/oneoff/repair_recording_tags.py --apply --workers 8`.
- **After it finishes:** delete `oneoff/` (repo + NAS) and the `docs/future.md` entry.

## Step 8 — docs

- **New `docs/scripts/tidy.md`:** TL;DR, Build, Usage, CLI flags table, Pipeline (ordered, with the
  reason for each ordering constraint: orphans before retire; box pass before re-score; second
  sweep), Watermark semantics (incl. "never touches lastSyncedAt"), Callers, Summary output, Relation
  to sync.
- **`CLAUDE.md`:**
  - Stack crate list: add `tidy`
  - Scripts block: add `./tidy [--all] [--only x]`; drop removed sync flags; replace "boxset::run_repair
    is automatic (tail of every sync…)" with tidy
  - Data Model box-set bullet: `sync::boxset::run_repair` → tidy
  - "Discarded merge" bullet: `delete_orphaned_mb_releases` before retire, now in tidy
  - scan-buttons paragraph + `scanActions` bullets: tidy follows sync
  - "No UI caller passes `--skip-resolve`" paragraph unchanged
- **`docs/scripts/sync.md`:** remove the dropped flags (Usage 55-60, table 89-98), delete the
  `--repair-recording-tags Behaviour` section (153), point the tail description to tidy.
- **`docs/sync_decisions.md`:**
  - §4/§6/§16: `--repair-artist-identities` → runs inside every `./tidy`
  - §9 "Why this runs once at the end of sync" → end of tidy; the re-score is in the same run
  - §10 last paragraphs: re-score in tidy
  - §19 item 5: replace the checklist with Step 10 below
  - §18 last row
- `docs/features_tagging.md:47` → the one-off script.
- `docs/future.md` → the recording-tags entry points to the one-off.

## Step 9 — tests

- **Rust (sync lib):**
  - `find_sibling_groups` scope SQL (scratch DB, pattern `sync/tests/catalogue_smoke.rs`): group kept
    whole, including other-artist siblings; unrelated parents excluded.
  - `load_mb_release_with_tracks` → `MbTrack` round-trip.
  - `rescore_bound_release`: dissolved disc with `mediumPosition` scores against that medium only;
    fold clears stale `mbTrackId`; no MB tracks → Deferred.
  - `track_metas_from_rows` unit test.
- **Rust (tidy):** watermark selection + stamp only when clean; integration: dissolve fixture → tidy →
  zero UNKNOWN and `lastSyncedAt` unchanged.
- **Rust (common):** lock heartbeat refreshes `scanLockedAt`; the guard drop stops it.
- **Web unit:**
  - `terminalCommand.test.ts`: `./tidy` allowed, `sync.run`, web mode; `--repair-recording-tags` no
    longer special.
  - `autoScan.test.ts:90`: index → sync → tidy.
  - settings/artist `ScanActions.test.ts`: sequences end with `./tidy`.
  - Rename `ButtonRefresh.ts` → `ButtonRefresh.test.ts`, fix it if stale, assert tidy.
- **e2e:** `web/e2e/scan-actions.spec.ts:130-245` expected sequences get `{ command: './tidy', args: [] }`.
  Run with `pnpm test:e2e` only (never bare playwright; `.env` is prod DB).
- **Python:** no suite (throwaway). The Step 7 validation runs are the test.
- **Commands:** `cd scripts && cargo build --release && cargo test`; `cd web && pnpm test:unit && pnpm test:e2e`.

## Step 10 — rollout (schema change → deploy is allowed)

1. `ssh nas 'tmux ls'`: kill leftovers. Check the lock:
   `SELECT "scanLockedBy" FROM "Statistics"` must be NULL.
2. `./deploy` (migration + new binaries + wrappers).
3. HIM pre-step: `./index --folders "HIM/Album/2002 - The Single Collection [#74321 96173 2]"`.
4. On NAS tmux: `./sync`, then `./tidy`. The first tidy is whole-library (all watermarks NULL), so it
   will take long: box-pass MB lookups over ~1300 groups.
5. Re-run the §17 split-disc SQL (docs/sync_decisions.md). Expect 3,411 unplaced → ~1,000, and 0
   `UNKNOWN` left by box placement.
6. `logs/errors.log`: no `Box-set repair error`.
7. A second `./tidy` prints "Nothing to tidy".
8. Separately, whenever the NAS is idle: Step 7 Python run.

## Verification checklist

- [ ] One `./sync && ./tidy` leaves no box-placed disc at UNKNOWN.
- [ ] `./tidy` right after that says "Nothing to tidy" within seconds.
- [ ] Ctrl-C tidy → no stamp → the next `./tidy` redoes the same artists.
- [ ] Tidy never changes `Artist.lastSyncedAt`.
- [ ] UI "Check for new files" terminal shows index → sync → tidy; the e2e spec passes.
- [ ] A >10-min tidy keeps its lock when another binary starts ("lock held", no steal).
- [ ] Python dry-run counts match the old Rust log (FŒHN 8, Elvis Presley ~1035).
