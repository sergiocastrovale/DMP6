# Scripts: tidy

Library-wide repair, split out of `sync`. `./sync` only ever visits pending artists, per-artist matching. Every repair needing the *whole* catalogue (empty/orphaned release cleanup, box-set binding, artist identity conflicts, score recompute) lives here, runs to completion in one invocation. Every caller chains `./tidy` after `./sync` — sync never calls it.

## TL;DR

```bash
./tidy                 # everything the lastTidiedAt watermark says is pending
./tidy --all           # ignore the watermark, tidy every synced artist
./tidy --only "Name" [--exact]
```

## Build

```bash
cd scripts && cargo build --release -p tidy
```

Depends on `sync`'s lib target (`dmp_sync`) for `db`/`boxset`/`box_editions`/`status`/`owned`/`mb_api`/`mb_matching`/`mb_types`/`catalogue_gaps`/`images` — rebuild `sync` first if those changed.

## Usage

```bash
./tidy                                    # watermark-scoped
./tidy --all                              # whole library, ignore watermark
./tidy --only "Radiohead" --exact         # narrow watermark set by name
./tidy --from "A" --to "M"                # letter range
./tidy --artist-ids /tmp/ids.txt          # explicit ids (used by ./refresh), bypasses watermark
./tidy --web                              # PROGRESS:{json} for web terminal
./tidy --rescore-only --all               # apply scorer-rule changes to already-scored releases, DB only
```

## CLI Flags

| Flag | Meaning |
|---|---|
| `--all` | Ignore `Artist.lastTidiedAt` — every artist `sync` has ever reached. Combinable with `--only`/`--from`/`--to` to force-tidy specific artists. |
| `--only <name>` / `-o` | Narrow to matching artists (prefix by default). |
| `--exact` | Exact-name match for `--only`. |
| `--from <name>` / `--to <name>` | Letter-range narrowing, same semantics as `sync`. |
| `--artist-ids <file>` | One id per line, bypasses watermark + `--only`/`--from`/`--to`. `./refresh` doesn't use this for tidy — kept for parity/manual use. |
| `--rescore-only` | Re-score bound releases (**including `MISSING_TRACKS`**) against the release on file, nothing else: no box pass, no cleanup, no identity repair, no MB calls, **no watermark stamp**. For rolling a scorer-rule change (`docs/sync_decisions.md` §8) out to already-scored releases — nothing else ever revisits a scored release. `--rescore-only --all` covers the whole library. |
| `--verbose` | Line per re-scored release. |
| `--web` | `PROGRESS:{"phase":"tidy",...}` lines for the web terminal. |

No `--dry-run` — same reasoning as sync's box pass: `./backup` is the recovery path, not an unread preview mode.

## Pipeline

10 phases, each its own error boundary (failure logged via `common::error_log::log_warn`, counted, run continues — one bad group/release never aborts the rest). `had_error` and `running` (false on Ctrl-C/SIGTERM) gate the final watermark stamp.

1. **Scope**: resolve artist id list (watermark or flags). Empty → "Nothing to tidy", release lock, exit 0.
2. **Empty local releases**: `db::delete_empty_local_releases(scope)`.
3. **Orphans + retire (round 1)**: `delete_orphaned_mb_releases(scope)` then `retire_owned_missing_placeholders()` — **order mandatory**, retire's live-download guard only works once the orphan is already gone.
3b. **Disc backfill** (global, pure SQL): `db::backfill_media_from_track_discs` — rebuilds medium rows/`mediumCount` for releases matched before discs were modelled (2026-09-06), from stored track disc numbers. Must precede the box pass (keys off `mediumCount>1`). Idempotent.
4. **Box pass**: `boxset::run_repair(scope)` — bind folder groups to a box-set release, derive equivalences, fold/dissolve. Groups found two ways: folders sharing a parent, and a root folder + subfolders bound to one multi-disc release (`nested_groups`). Sets `matchStatus='UNKNOWN'` on everything touched (→ `touched_local_release_ids`).
5. **Re-score**: `db::get_rescore_targets` unions 3 sources — scoped `UNKNOWN` releases with a bound release **and no no-guessing `statusReason`** (`docs/no_guessing.md`: that reason is terminal, explicit `AND "statusReason" IS NULL` guard so `--rescore-only --all` can never resurrect one even though `releaseId IS NULL` already excludes it in practice); this run's `touched_local_release_ids`; any scoped release with a track link pointing at a *different* release than the folder is bound to (catches discs the pre-tidy sync-era box pass dissolved — `apply_dissolve` only sets `UNKNOWN` when something changed, so these fell through the cracks: 1,336 stale links / 122 releases after the 2026-09-17 rollout). `db::rescore_bound_release` re-runs `check_release_status` against the release on file (no MB call), re-links matched tracks, clears `mbTrackId` on non-matches, writes `matchStatus`. No MB release/no local tracks → `Deferred`, stays `UNKNOWN` for `sync`'s own watermark clause.
6. **Orphans + retire (round 2)**: same two calls as phase 3 — dissolving a box can surface fresh orphans/placeholders.
7. **Artist identity repair** (global, pure SQL, always runs): `repair_all_empty_primaries` → `repair_contradicted_identities` → `repair_shared_identities` (`docs/sync_decisions.md` §5/§6). Moved verbatim from `sync --repair-artist-identities`.
8. **Completeness**: `--all` → `recompute_all_completeness` (one set-based UPDATE). Otherwise per scoped artist **plus** every owner of a release the box pass or re-score touched.
9. **Statistics**: `common::statistics::update_statistics`.
10. **Watermark stamp**: only if `running && !had_error`. `--all` → every artist with `lastSyncedAt IS NOT NULL`; else the scoped id list — stamped to this run's *start* time, not `NOW()` (an artist re-synced mid-tidy must stay pending). **Never calls `update_artist_sync_stats`** (would stamp `lastSyncedAt`, hiding it from sync's pending clause). Artists whose box group hit an MB lookup failure are excluded from the stamp (503 isn't a settled answer) — deliberately not `had_error` (would unstamp the whole scope over one failed request). Known limitation: the held-back artist is whichever one `boxset::artist_for_group` picked (`LIMIT 1`), not necessarily the artist that pulled a multi-artist group in — group stays unbound either way, so it resurfaces once any of its artists is pending again (a nudge, not a guarantee).

## Watermark semantics

`Artist.lastTidiedAt DateTime?`. Plain scope query:

```sql
SELECT id, name FROM "Artist"
WHERE "lastSyncedAt" IS NOT NULL
  AND ("lastTidiedAt" IS NULL OR "lastSyncedAt" > "lastTidiedAt")
```

- `lastSyncedAt IS NOT NULL` — tidy only ever follows a sync.
- Stamped only on a clean finish — a killed/partial run leaves everything it touched pending, next `./tidy` redoes the same set.
- **Never touches `Artist.lastSyncedAt`** — a missed/interrupted tidy self-heals, never makes sync think a re-sync is needed.
- **`lastTidiedAt` set while `lastSyncedAt` is NULL is expected**, not a violated invariant — phase 7's identity repair clears `lastSyncedAt` on an artist whose identity it just revoked (so sync re-derives it, `docs/sync_decisions.md` §6), phase 10 then stamps the whole scope including that artist. 215 artists were in this state after the 2026-09-17 run.
- `index` sets `matchStatus='UNKNOWN'` on track deletion too, and a box dissolve/fold sets it — both covered because phase 5 re-checks `matchStatus='UNKNOWN'` directly, not just `touched_local_release_ids`.

First `./tidy` after this feature shipped processed the whole library (every `lastTidiedAt` NULL) — expected, it doubled as the box-set repair rollout.

## Lock

Shares `Statistics.scanLockedBy` with `index`/`sync`/`fix`/`nuke`/`delete`/`playlists` (`common::lock`). `LockGuard` heartbeats `scanLockedAt` every 60s, so `clear_stale_lock_minutes`'s 10-min threshold only fires on a genuinely dead process — a first whole-library tidy over ~1300 box groups can run for hours.

## Callers

Every UI scan action, `./refresh`, auto-scan chain `./tidy` after `./sync` with **no explicit scope** — tidy's own watermark already narrows to exactly the artists sync just touched. Only `--web`/`--verbose` forwarded from `./refresh`. Button→command mapping: `CLAUDE.md` scan-buttons paragraph.

## Summary output

Elapsed time, then: empty releases removed; orphans/placeholders retired (both rounds); box groups seen/bound/folded/dissolved/key-taken/failed/from-DB; **`not bound:` breakdown** (no candidate, fetch error, no match, ambiguous, collision, no artist link, under 2 siblings); re-scored per status + deferred + stale-link-only count; identity Pass A/B/C; completeness recomputed; artists stamped (+ held-back-for-retry count, or "NOT stamped: errors"/"NOT stamped: interrupted").

`groups seen` only counts groups with a chance to bind — under-2-siblings parents go in their own bucket, not the denominator.

## Relation to sync

| | `sync` | `tidy` |
|---|---|---|
| Scope | Pending artists (`lastIndexedAt`/`lastSyncedAt`/`UNKNOWN` clause) | `lastTidiedAt` watermark |
| MB calls | Per-release matching, box-set candidate search | Box pass only; re-score makes none |
| Writes `lastSyncedAt` | Yes | Never |
| Writes `lastTidiedAt` | Never | Yes, on clean finish |
| Box-set repair | Not run | `boxset::run_repair` |
| Artist identity repair | Not run | 3 passes, always global |
| `--repair-recording-tags` | Removed — one-off Python script, run once 2026-09-18, deleted (`docs/specs/spec_tidy_observations.md` §17) | N/A |

Design history/rollout checklist: `docs/specs/spec_tidy_script.md`. Box-set binding/fold/dissolve rules `boxset::run_repair` implements: `docs/sync_decisions.md`.
