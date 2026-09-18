# Spec: `./tidy` — library-wide repair split out of `./sync`

**Status: implemented, rolled out** (built 2026-09-12/13, first whole-library run 2026-09-17, Step 7 one-off run 2026-09-18). Design history only — current behavior: `docs/scripts/tidy.md`. Rollout findings: `docs/specs/spec_tidy_observations.md`. Do not re-execute these steps.

## Problem
`./sync` ran library-wide repairs at its tail — box-set pass set discs `UNKNOWN`, only the *next* sync re-scored them, so operators had to run sync twice. Other repairs hid behind standalone flags (`--repair-artist-identities`, `--repair-shared-release-ids`, `--recompute-scores`, `--repair-recording-tags`).

## Decision
- New binary `./tidy` (crate `scripts/tidy`) does every library-wide repair/reorganize step in one run. `./sync` does per-artist matching only.
- Watermark: `Artist.lastTidiedAt`. Plain `./tidy` processes `lastSyncedAt IS NOT NULL AND (lastTidiedAt IS NULL OR lastSyncedAt > lastTidiedAt)`; stamps `lastTidiedAt = <tidy start time>` only if the run wasn't interrupted/errored — self-heals on next run.
- Every caller chains `./tidy` after `./sync` (UI, `./refresh`, auto-scan). Sync never calls tidy.
- `sync` becomes lib+bin (`dmp_sync`) — `tidy` depends on its lib. Moving shared code to `common` would drag in all of `db.rs`, so this was rejected.
- `--repair-recording-tags` became a throwaway Python script in top-level `oneoff/` (deleted after its one run) — not deployed, no scan lock needed (only touches recording/release-track tag slots, mtime preserved).
- `--repair-shared-release-ids` deleted outright — its guard was already removed since shared `releaseId`s are legitimate duplicate copies now; running it would unbind legitimate rows.

## Facts still worth knowing
- **Watermark trap:** `db::update_artist_sync_stats` stamps `lastSyncedAt` — tidy must never call it, or an artist stays pending forever. `common::totals::recompute_artist_completeness` only touches `completeness`, safe.
- **Lock:** `scripts/common/src/lock.rs` had no heartbeat originally — any binary starting after the 10-min stale threshold stole a live lock. Fixed: `acquire_lock` returns a `LockGuard` that heartbeats `scanLockedAt` every 60s; `Drop` stops it.
- **Ordering mandatory:** `delete_orphaned_mb_releases` before `retire_owned_missing_placeholders`, at every call site.
- **Box pass:** `apply_fold` leaves `LocalReleaseTrack.mbTrackId` untouched (stale links possible) — the DB-only re-score step must clear mbTrackId on tracks not in the matched set. `apply_dissolve` sets `matchStatus='UNKNOWN'` only when something changed.
- **Tag key names by format** (used by the recording-tags one-off, mirrors `common::tags::MbSlots`):
  - Vorbis (FLAC/Ogg/Opus): recording=`MUSICBRAINZ_TRACKID`, release-track=`MUSICBRAINZ_RELEASETRACKID` (case-insensitive).
  - MP4: `----:com.apple.iTunes:MusicBrainz Track Id` / `...Release Track Id` (bytes, `MP4FreeForm`).
  - ID3 (MP3/AAC): recording=UFID frame owner `http://musicbrainz.org`; release-track=TXXX `MusicBrainz Release Track Id`.
  - APE: same keys as Vorbis.
- **NAS runtime for one-offs:** ssh as `Kp` (uid 3000, owns music files → `os.utime` works). Python 3.11.9, mutagen 1.47, psycopg2 installed. Music at `/mnt/dmp/music/mainstream` (container sees `/music`). Postgres container `ix-postgres-postgres-1`, `DATABASE_URL` in `/mnt/SSD/web/dmp/.env`.

## Rollout steps taken (reference only)
1. Schema: `Artist.lastTidiedAt DateTime?` migration, no backfill (first tidy = whole library, doubled as the box-set rollout).
2. `sync` → lib+bin split; extracted `status::track_metas_from_rows`, `db::load_mb_release_with_tracks`.
3. `scripts/tidy` crate: pipeline = scope by watermark → delete empty/orphaned releases → box pass (scoped by artist ids) → DB-only re-score of `UNKNOWN` bound releases → orphan sweep again → artist identity repair (3 passes) → completeness recompute → stamp `lastTidiedAt`. Each phase has its own error boundary (one phase's error logs + continues, never aborts the run).
4. Stripped the moved flags out of `sync`; kept `write_mb_ids` self-heal and the `UNKNOWN` clause in `get_artists_pending_sync` (index still sets UNKNOWN on track deletion, tidy still defers rows).
5. Wired every UI/CLI caller (`ScanActions.vue` ×2, `ButtonRefresh.vue`, `./refresh`, `autoScan.ts`) to chain `./tidy` after `./sync`.
6. One-off Python script (`oneoff/repair_recording_tags.py`): read/plan/apply recording+release-track tag slots by format, CSV undo record, `--resume` checkpoint, validated on FŒHN (8 files) and Elvis Presley (~1035) before the full run. Deleted after completion.
7. Docs updated: `docs/scripts/tidy.md` (new), `CLAUDE.md`, `docs/scripts/sync.md`, `docs/sync_decisions.md`.
8. Tests added at every layer (Rust sync lib + tidy + common lock heartbeat; web unit `terminalCommand`/`autoScan`/`ScanActions`; e2e `scan-actions.spec.ts`).
9. Prod rollout: `./deploy`, one HIM pre-step re-index, `./sync && ./tidy` on NAS tmux (first tidy = whole library, ~1300 box groups), verified 0 `UNKNOWN` left by box placement, second `./tidy` says "Nothing to tidy".

## Verification checklist (all passed)
- One `./sync && ./tidy` leaves no box-placed disc at `UNKNOWN`.
- Immediate re-run of `./tidy` says "Nothing to tidy" within seconds.
- Ctrl-C tidy → no stamp → next `./tidy` redoes the same artists.
- Tidy never changes `Artist.lastSyncedAt`.
- UI "Check for new files" terminal shows index → sync → tidy.
- A >10-min tidy keeps its lock when another binary starts (no steal).
- Python dry-run counts matched the old Rust log (FŒHN 8, Elvis Presley ~1035).
