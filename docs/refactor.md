# Scripts hardening & refactor — 2026-09-23

Report for the `scripts/` hardening pass approved in `/home/kp/.claude/plans/composed-giggling-snowglobe.md`.
Every commit below is on `master`, deployed, and smoke-tested on the NAS unless noted. Full commit
range: `f95f709d..HEAD` in `scripts/`.

## Phase 0 — Safety net

- `scripts/restore`: targets `RESTORE_DATABASE_URL` only, refuses the prod host without
  `--force-remote`, confirms before running.
- `scripts/test-db`: disposable postgres:18.4 container, `prisma migrate deploy`, a raw-index drift
  check, then the full workspace test suite including `--ignored` DB integration tests.
- `scripts/check` (fmt, clippy, tests, CLI-contract snapshot; `--db` adds `test-db`) + a GitHub Actions
  job running it.
- `scripts/replay`: clone-per-run replay harness against a recorded prod dump, for verifying a fix's
  behaviour delta before it ships.
- `MB_USER_AGENT`/`MB_BASE_URL`/`COVER_ART_ARCHIVE_URL` made configurable (were hardcoded/placeholder).
- Characterization tests pinning behaviour slated for later consolidation.

## Phase 0.5 — DB performance

- Pattern-ops indexes on `LocalReleaseTrack.filePath` / `LocalRelease.folderPath` (per-folder `LIKE`
  lookups were a parallel seq scan of ~1.9M rows under the non-C collation; now sub-millisecond).
  Deployed; smoke test surfaced the box-orphan bug fixed in 1A-db below.

## Phase 1A-files — irreversible file damage

- MP3 tag writes moved off lofty's generic `Tag` (silently dropped `MusicBrainzReleaseId`/
  `ReleaseGroupId`/`TrackId` on every resave) onto the concrete `Id3v2Tag`, with ID3v2.3's UTF-16/
  Timestamp-frame requirements handled. Covers `embed_cover_art`, `fix`, `problems`.
- `delete`'s folder removal never deletes a folder still holding non-indexed audio/unknown files.
- Every image delete now reads what a row points at before the row is gone, and deletes files only
  after the DB commit, checking the file is genuinely unreferenced first.

## Phase 1A-db — data-loss / corruption

- `classify_mb_error` parses the HTTP status/error prefix instead of substring-matching the message
  (an id or URL containing "404"/"503" no longer misclassifies).
- A sync lookup or release-group-fetch failure no longer stamps `lastSyncedAt` — the artist stays
  pending instead of silently reading as "synced, no match".
- `bind_local_release`: binding a release is one transaction (link tracks, clear stale links, set
  status) — a partial bind can no longer happen.
- `box_editions` tiers 2/3 restricted to multi-medium releases: a single-medium release was matching
  *itself* as its own "equivalent edition", the root cause of prod showing 58,960
  `MusicBrainzReleaseMedium` rows "also part of" their own release. Web's `accumulateAlsoPartOf` now
  also skips a medium whose own release is in the group it points at.
  **One-off applied**: backed up the prod DB, cleared all 58,960 (well, 59,035 measured at run time)
  self-equivalent rows, verified 0 remain (`scripts/sql/oneoff_clear_self_equivalent_media.sql`).
- `index --resume`: the deleted-folder sweep now counts every folder on disk as scanned, not just the
  ones this particular resumed run walked — a checkpoint-skipped head no longer reads as deleted.
  `detect_deleted_folders`'s own DB read propagates errors instead of defaulting to "no known
  folders". An interrupted run keeps its checkpoint and run hash instead of clearing them.
- Deferred artist-name resolution (MusicBrainz unreachable for one name) no longer wipes a track's
  existing `TrackRelatedArtist` credits — such tracks are excluded from the reconcile diff entirely.
  Reconcile also inserts before deleting, in one transaction.
- `SUM(DISTINCT "fileSize")` in artist totals undercounted: two tracks that happen to share a byte
  size were counted once. Changed to a plain `SUM`.
- Lock: `release_lock` now clears only when `scanPid`+`scanLockedBy` still match the caller — it used
  to clear unconditionally, so a process whose lock had already been cleared as stale (while still
  running) could steal back and clear whoever acquired the lock next. A DB error during acquire no
  longer reads as "lock held". Stale threshold 10min → 3min, one shared constant used by all 9
  binaries (was a hardcoded `10` at each of 9 call sites).
- Retired `index --delete` / `sync --delete` (superseded by `./delete` / `./nuke --only`, which now
  share one guarded deletion path in `common::cleanup` / `delete::artist` — a co-owned release is kept,
  not deleted, when only one of its owning artists is targeted).
- Audit's numeric-artist-name whitelist unified with `problems`' copy (was two lists, could drift);
  every `status IN (...)` dedupe includes `FAILED`.

Deployed after this batch; smoke-tested `index`/`sync`/`tidy` on a real artist on the NAS, 0 errors.

## Phase 1B — correctness, panics, reporting (partial — highest-risk items)

- `fix`'s tag-writing paths (`corrupted`, `missing`) now commit the `FixHistory` revert record and the
  issue's `RESOLVED` status in the same transaction as the file write, and only after the write
  succeeds — previously the file was written first, so a crash between the write and the DB commit
  left a mutated file with no recorded "previous state" to revert it from.
- Three `&s[..8]` byte-offset slices (on hashes/cuids) replaced with `.get(..8)` — panics on any string
  under 8 bytes; never observed in practice but not guaranteed by the data shape.
- `playlists`' word-boundary search (`contains_as_word`) advanced its cursor by one raw byte after a
  rejected match; on a genre/region name containing a multi-byte UTF-8 character this could land
  mid-character and panic the next slice. **Reproduced and fixed**: advances by one whole character
  now. Regression test confirms the pre-fix panic and the post-fix pass.
- `lock::expect_or_release`: a DB read failing while the scan lock is held used to `.expect()` and
  panic — with `panic = abort` in the release profile, that skips every `release_lock` call in the
  function, leaking the lock until the stale timeout. `sync` and `playlists`' locked-section DB reads
  now go through a shared helper that releases the lock and exits cleanly on error instead.
- `sync`'s artist-matching rung 2 (release-group credit lookup) accepted a *similar* name match; a
  release group's credit list can include a co-credited artist (remixer, compilation contributor) with
  a similar name and no other evidence to prefer the right one — tightened to an exact match.
  `get_artist_for_release` now sanitizes the stored MB id like every other reader.
- `boxset`'s two `println!` calls never reached `--web` mode's output — routed through `Reporter`.
  Five call sites double-logged every warning to `errors.log` (`reporter.warn` already logs); removed
  the redundant explicit `log_warn`.
- `tidy`'s scope-load: a bad `--artist-ids` path panicked; a DB error on the default scope query
  silently became "0 artists in scope", printed "Nothing to tidy" and exited 0. Both now fail loudly
  with a non-zero exit (lock released first).
- `audit` now exits non-zero when any detector errors — previously every detector's error was printed
  and swallowed into a `0` count, so a monitor watching the exit code never saw a failed run.

Deployed after this batch; smoke-tested `fix --missing`, `tidy --rescore-only`, and a full-library
`audit` run on the NAS — all exit 0, `errors.log` empty.

## Not done this pass

The plan's remaining scope (rest of 1B, and phases 2a/3/4/5/6 — dead-code removal, `common`
consolidation, performance, module/struct restructuring, and the docs split) was surveyed against the
approved plan but not executed in this session. Reasoning: the items completed above are the plan's
own highest tier (confirmed live-data bugs, panics, data-loss risk); the remainder is explicitly lower
risk in the plan itself — dead code removal, comment rewrites, consolidating duplicated helpers,
splitting large modules, and performance tuning — and doing that scale of change (dozens more files
across all 16 crates) properly, each with its own test/replay verification and a deploy checkpoint, is
a multi-session undertaking. Rushing it in one pass risks exactly the kind of regression this whole
exercise exists to prevent.

Remaining known items from the plan, for the next pass:
- `fix`: `--mode` as a `ValueEnum` instead of a raw string; `--dry-run`.
- `audit`'s 7 detectors still `DELETE` stale rows then re-`INSERT` outside a transaction — a crash
  mid-run temporarily under-reports newly detected (not yet queued) issues until the next successful
  run; low severity since `PENDING`/`RESOLVED`/`FAILED` rows are untouched and never lost, but worth
  wrapping in a transaction.
- `add`: MB gap errors should surface as failure; `--verbose` correctness.
- `problems`: summary reporting, fixed-ledger reset, year error text, `--fix:artist` albumArtist
  handling, `id3raw::read_exact`, extension allow-list, `--resume`+`--restart` rejection.
- `playlists`: prune playlists whose generator no longer qualifies; one `primaryArtistId` rule.
- `analysis`: quarantine overwrite guard, staging-dir exclusion, year cap from clock.
- `dissect`/`mosaic`/`artist-photos`: regex/log-path, holes/paths, artist-root scoping.
- lofty 0.24 `ItemKey` metadata-matching investigation (report-only per the plan; not started).
- Phase 2a (dead code, env-neutral shell scripts, `clippy -D warnings`), Phase 3 (consolidation into
  `common`), Phase 4 (measured perf work), Phase 5 (structure/comment cleanup), Phase 6 (docs split
  into reference vs `docs/history/`).

## Verification

Every commit above passed `scripts/check --db` (fmt, clippy, full workspace test suite incl. `--ignored`
DB-integration tests on a disposable Postgres 18.4, CLI-contract snapshot, Prisma drift check) before
being pushed. Two behaviour-changing fixes (`box_editions` self-equivalence, `contains_as_word`
panic) have a regression test that reproduces the bug on the pre-fix code and passes on the fix.
Both deployed batches were smoke-tested against the live NAS instance (`index`/`sync`/`tidy` on a real
artist, `fix --missing`, `tidy --rescore-only`, and a full-library `audit` run) with a clean
`errors.log`.
