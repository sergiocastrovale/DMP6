# Scripts: tidy

Library-wide repair, split out of `sync`. A plain `./sync` only ever visits "pending" artists and does
per-artist matching; every repair that has to see the *whole* catalogue (empty/orphaned release
cleanup, box-set binding, artist identity conflicts, score recompute) now lives here instead, and runs
to completion in one invocation. Every caller chains `./tidy` after `./sync` — `sync` itself never
calls it.

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

`tidy` depends on `sync`'s library target (`dmp_sync`, `[lib] name` in `scripts/sync/Cargo.toml`) for
`db`, `boxset`, `box_editions`, `status`, `owned`, `mb_api`, `mb_matching`, `mb_types`,
`catalogue_gaps`, `images` — rebuild `sync` first if those modules changed.

## Usage

```bash
./tidy                                    # watermark-scoped
./tidy --all                              # whole library, ignore the watermark
./tidy --only "Radiohead" --exact         # narrow the watermark set by name
./tidy --from "A" --to "M"                # letter range
./tidy --artist-ids /tmp/ids.txt          # explicit ids (used by ./refresh), bypasses the watermark
./tidy --web                              # PROGRESS:{json} lines for the web terminal
```

## CLI Flags

| Flag | Meaning |
|---|---|
| `--all` | Ignore `Artist.lastTidiedAt` — process every artist `sync` has ever reached. Combinable with `--only`/`--from`/`--to` to force-tidy specific artists even when not currently pending. |
| `--only <name>` / `-o` | Narrow to artists whose name matches (prefix by default). |
| `--exact` | Exact-name match for `--only`, no prefix matching. |
| `--from <name>` / `--to <name>` | Letter-range narrowing, same semantics as `sync`. |
| `--artist-ids <file>` | One artist id per line. Bypasses the watermark and `--only`/`--from`/`--to` entirely. `./refresh` does **not** use this for tidy (see Callers below) — kept for parity with `sync`/`index` and for manual/scripted use. |
| `--verbose` | Prints a line per re-scored release. |
| `--web` | Emits `PROGRESS:{"phase":"tidy",...}` lines for the web terminal. |

No `--dry-run`: same reasoning as `sync`'s own box pass (docs/sync_decisions.md) — the recovery path is
`./backup`, not a preview mode nobody reads.

## Pipeline

Runs as ten phases in order, each in its own error boundary (a phase's failure is logged via
`common::error_log::log_warn`, counted, and the run continues — one bad group or release must never
abort everything after it, same rule box-set repair already followed). `had_error` (any phase failed)
and `running` (Ctrl-C/SIGTERM sets this false) gate the final watermark stamp.

1. **Scope**: resolve the artist id list (watermark, or `--all`/`--only`/`--from`/`--to`/`--artist-ids`
   per above). Empty → print "Nothing to tidy", release the lock, exit 0.
2. **Empty local releases**: `dmp_sync::db::delete_empty_local_releases(scope)`.
3. **Orphans + retire (round 1)**: `delete_orphaned_mb_releases(scope)` then
   `retire_owned_missing_placeholders()` — **order mandatory**, retire's live-download guard only works
   once the orphan is already gone (see the function's own doc comment).
4. **Box pass**: `dmp_sync::boxset::run_repair(scope)` — bind sibling folder groups to a box-set
   `MusicBrainzRelease`, derive equivalences, fold or dissolve. Sets `matchStatus='UNKNOWN'` on
   everything it touches; those ids come back as `touched_local_release_ids`.
5. **Re-score**: `db::get_rescore_targets` = every scoped `LocalRelease` at `matchStatus='UNKNOWN'` with
   a release bound, unioned with this run's own `touched_local_release_ids` (a safety net — box pass
   output should already be a subset). `db::rescore_bound_release` re-runs `check_release_status`
   against the release already on file (no MusicBrainz call), re-links matched tracks, clears
   `mbTrackId` on anything a fold moved that didn't re-match, and writes the new `matchStatus`. No MB
   release found or no local tracks yet → `Deferred`, left at `UNKNOWN` so a plain `sync`'s own watermark
   clause picks it up later.
6. **Orphans + retire (round 2)**: same two calls as phase 3. Dissolving a box makes release groups
   owned that weren't before, which can surface fresh orphans/placeholders.
7. **Artist identity repair** (global, pure SQL, always runs regardless of scope):
   `repair_all_empty_primaries` → `repair_contradicted_identities` → `repair_shared_identities`, in that
   order (docs/sync_decisions.md §5/§6). Moved verbatim from `sync --repair-artist-identities`.
8. **Scores**: `--all` (unscoped run) → `recompute_all_match_scores` (one set-based UPDATE). Otherwise
   `common::totals::recompute_artist_match_score` for every scoped artist **plus** every owner
   (`LocalReleaseArtist`) of a release the box pass or re-score actually touched — a sibling group
   frequently spans more than one artist's folders.
9. **Statistics**: `common::statistics::update_statistics`.
10. **Watermark stamp**: only if `running && !had_error`. `--all` → every artist with `lastSyncedAt IS
    NOT NULL` (`stamp_all_tidied`); otherwise the scoped id list (`stamp_artists_tidied`), stamped to
    this run's *start* time, not `NOW()` — an artist re-synced mid-tidy must stay pending for the next
    run. **Never calls `update_artist_sync_stats`** (that stamps `lastSyncedAt`, which would make the
    artist look freshly synced and hide it from `sync`'s own pending clause).

## Watermark semantics

`Artist.lastTidiedAt DateTime?`. The plain (no-flag) scope query:

```sql
SELECT id, name FROM "Artist"
WHERE "lastSyncedAt" IS NOT NULL
  AND ("lastTidiedAt" IS NULL OR "lastSyncedAt" > "lastTidiedAt")
```

- `lastSyncedAt IS NOT NULL` — tidy only ever follows a sync; an artist sync hasn't reached yet isn't
  tidy's problem.
- Stamped only when the run finished clean (`running && !had_error`) — a killed or partially-failed run
  leaves every artist it touched pending, so the *next* `./tidy` redoes exactly the same set.
- **Never touches `Artist.lastSyncedAt`.** A missed or interrupted tidy self-heals on the next run; it
  can never make sync think an artist needs re-syncing (or hide it from sync's own pending query).
- `index` still sets `LocalRelease.matchStatus = 'UNKNOWN'` on track deletion, and a box dissolve/fold
  sets it too — both are covered because phase 5's target query re-checks `matchStatus='UNKNOWN'`
  directly, not just this run's own `touched_local_release_ids`.

The very first `./tidy` after this feature ships processes the *whole* library (every `lastTidiedAt` is
NULL) — expected, since it's also the box-set repair rollout.

## Lock

Shares the same `Statistics.scanLockedBy` exclusive lock as `index`/`sync`/`fix`/`nuke`/`delete`/
`playlists` (`common::lock`). Held for the whole run via a `LockGuard` that heartbeats
`scanLockedAt` every 60s, so `clear_stale_lock_minutes`'s 10-minute threshold only ever fires on a
genuinely dead process — a first whole-library tidy over ~1300 box groups can run for hours.

## Callers

Every UI scan action, `./refresh`, and auto-scan chain `./tidy` after `./sync` with **no explicit
scope** — tidy's own watermark already narrows to exactly the artists that sync just touched, since
sync just moved their `lastSyncedAt` forward. Only `--web`/`--verbose` are forwarded from `./refresh`.
See `CLAUDE.md`'s scan-buttons paragraph for the exact button → command-sequence mapping.

## Summary output

One elapsed-time line, then: empty releases removed; orphans/placeholders retired (both rounds); box
groups seen/bound/folded/dissolved/key-taken/failed; re-scored counts per status + deferred; identity
Pass A/B/C counts; scores recomputed; artists stamped (or "NOT stamped: errors" / "NOT stamped:
interrupted").

## Relation to sync

| | `sync` | `tidy` |
|---|---|---|
| Scope | Pending artists (`lastIndexedAt`/`lastSyncedAt`/`UNKNOWN` clause) | `lastTidiedAt` watermark |
| MusicBrainz calls | Per-release matching, box-set candidate search | Box pass only (candidate search/lookup); re-score makes none |
| Writes `lastSyncedAt` | Yes | Never |
| Writes `lastTidiedAt` | Never | Yes, on a clean finish |
| Box-set repair | Not run | `dmp_sync::boxset::run_repair` |
| Artist identity repair | Not run | 3 passes, always global |
| `--repair-recording-tags` | Removed — see `oneoff/repair_recording_tags.py` (one-off, not a flag anywhere) | N/A |

See `docs/__plan_tidy_script.md` for the full design history and rollout checklist, and
`docs/sync_decisions.md` for the box-set binding/fold/dissolve rules `boxset::run_repair` implements.
