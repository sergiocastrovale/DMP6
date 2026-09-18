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
./tidy --rescore-only --all               # apply scorer-rule changes to already-scored releases, DB only
```

## CLI Flags

| Flag | Meaning |
|---|---|
| `--all` | Ignore `Artist.lastTidiedAt` — process every artist `sync` has ever reached. Combinable with `--only`/`--from`/`--to` to force-tidy specific artists even when not currently pending. |
| `--only <name>` / `-o` | Narrow to artists whose name matches (prefix by default). |
| `--exact` | Exact-name match for `--only`, no prefix matching. |
| `--from <name>` / `--to <name>` | Letter-range narrowing, same semantics as `sync`. |
| `--artist-ids <file>` | One artist id per line. Bypasses the watermark and `--only`/`--from`/`--to` entirely. `./refresh` does **not** use this for tidy (see Callers below) — kept for parity with `sync`/`index` and for manual/scripted use. |
| `--rescore-only` | Re-score bound releases — **including ones already `MISSING_TRACKS`** — against the release on file, and do nothing else: no box pass, no cleanup, no identity repair, no MusicBrainz calls, and **no watermark stamp** (the box pass did not run, so the artists are not "tidied"). For applying an improvement to the scorer's own rules (docs/sync_decisions.md §8) to releases scored before it existed; nothing else ever revisits a release once it has a status. `./tidy --rescore-only --all` covers the whole library. |
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
5. **Re-score**: `db::get_rescore_targets` unions three sources — every scoped `LocalRelease` at
   `matchStatus='UNKNOWN'` with a release bound; this run's own `touched_local_release_ids` (a safety
   net, box pass output should already be a subset); and any scoped release holding a
   `LocalReleaseTrack.mbTrackId` that belongs to a **different** release than the folder is bound to.
   That third source exists because a disc the *pre-tidy, sync-era* box pass dissolved is at neither
   `UNKNOWN` nor in `touched_ids` — `apply_dissolve` only sets `UNKNOWN` when something changed — so its
   tracks kept pointing at the box's rows forever (1,336 such links across 122 releases after the
   2026-09-17 rollout). `db::rescore_bound_release` re-runs `check_release_status` against the release
   already on file (no MusicBrainz call), re-links matched tracks, clears `mbTrackId` on anything that
   didn't re-match, and writes the new `matchStatus`. No MB release found or no local tracks yet →
   `Deferred`, left at `UNKNOWN` so a plain `sync`'s own watermark clause picks it up later.
6. **Orphans + retire (round 2)**: same two calls as phase 3. Dissolving a box makes release groups
   owned that weren't before, which can surface fresh orphans/placeholders.
7. **Artist identity repair** (global, pure SQL, always runs regardless of scope):
   `repair_all_empty_primaries` → `repair_contradicted_identities` → `repair_shared_identities`, in that
   order (docs/sync_decisions.md §5/§6). Moved verbatim from `sync --repair-artist-identities`.
8. **Completeness**: `--all` (unscoped run) → `recompute_all_completeness` (one set-based UPDATE). Otherwise
   `common::totals::recompute_artist_completeness` for every scoped artist **plus** every owner
   (`LocalReleaseArtist`) of a release the box pass or re-score actually touched — a sibling group
   frequently spans more than one artist's folders.
9. **Statistics**: `common::statistics::update_statistics`.
10. **Watermark stamp**: only if `running && !had_error`. `--all` → every artist with `lastSyncedAt IS
    NOT NULL` (`stamp_all_tidied`); otherwise the scoped id list (`stamp_artists_tidied`), stamped to
    this run's *start* time, not `NOW()` — an artist re-synced mid-tidy must stay pending for the next
    run. **Never calls `update_artist_sync_stats`** (that stamps `lastSyncedAt`, which would make the
    artist look freshly synced and hide it from `sync`'s own pending clause).
    **Artists whose box group hit a MusicBrainz lookup failure are excluded from the stamp** and stay
    pending, so the next run retries them — a 503 is not a settled answer. Deliberately not treated as
    `had_error`: that would unstamp every artist in scope and redo the whole library over one failed
    request.
    Known limitation: the artist held back is whichever one `boxset::artist_for_group` picked for that
    group (a `LIMIT 1` over its `LocalReleaseArtist` rows), which on a group spanning several artists is
    not necessarily the scoped artist that pulled it in. The group itself is still unbound either way, so
    it comes back into view as soon as any of its artists is pending again — the hold is a nudge, not a
    guarantee.

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
- **`lastTidiedAt` set while `lastSyncedAt` is NULL is expected, not a violated invariant.** Phase 7's
  identity repair clears `lastSyncedAt` on an artist whose stored MusicBrainz identity it just took
  away, precisely so sync picks the entry back up and re-derives it (docs/sync_decisions.md §6); phase
  10 then stamps the whole scope, that artist included. 215 artists were in this state after the
  2026-09-17 run.
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
groups seen/bound/folded/dissolved/key-taken/failed/from-DB; **a `not bound:` line breaking the
remainder down by reason** (no candidate, fetch error, no match, ambiguous, collision, no artist link,
under 2 siblings); re-scored counts per status + deferred, with how many were picked up only for stale
track links; identity Pass A/B/C counts; completeness recomputed; artists stamped, with how many were
held back for retry (or "NOT stamped: errors" / "NOT stamped: interrupted").

`groups seen` counts only groups that had a chance to bind — a parent with fewer than two sibling
folders is reported under `under 2 siblings` rather than padding the denominator.

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
