# Scripts architecture

How the `scripts/` Rust workspace fits together: crate map, `common`'s module shape, the
lock/bootstrap model every binary shares, the error-propagation policy, and the load-bearing
contracts the web app depends on. Per-binary behavior is documented separately — see `scripts/
README.md`'s table for the full crate → docs pointer list; this file is the connective tissue between
crates, not a restatement of any one binary's logic.

## Crate map

16 crates in one Cargo workspace (`scripts/Cargo.toml`), all binaries except `common` (lib-only) and
`sync` (lib + bin — `tidy`/`add` depend on its lib for db/boxset/status/catalogue-gaps functions
rather than shelling out):

| Crate | Kind | Role |
|---|---|---|
| `common` | lib | Shared DB/MB/lock/config/consensus code every other crate depends on |
| `index` | bin | Scans local files, extracts tags, resolves artist identity, writes the local DB tree |
| `sync` | lib+bin | Matches indexed releases against MusicBrainz, binds ids, writes MB tree |
| `tidy` | bin | Library-wide repair split out of sync: box-set binding, identity repair, re-score, cleanup |
| `add` | bin | Adds an MB artist before any local file exists for them |
| `audit` | bin | Read-only DB scan for known defect shapes (corrupted/orphans/duplicates/missing/etc) |
| `fix` | bin | Applies (or reverts) the fixes `audit` queued |
| `problems` | bin | Read-only tag-defect scan across files themselves (not DB), → `problems.xlsx` |
| `delete` | bin | Cascade-deletes an artist or a single release |
| `nuke` | bin | Full-library or single-artist wipe |
| `playlists` | bin | Regenerates GENRE/REGION playlists from `PlaylistGenerator` DB rows |
| `analysis` | bin | Standalone library-quality HTML report, independent of the DB |
| `extract-meta-images` | bin | Backfills cover art from embedded tag images |
| `artist-photos` | bin | Backfills artist photos from an external source |
| `mosaic` | bin | Generates a mosaic image; invoked by the web app, no shell wrapper |
| `dissect` | bin | Turns `errors.log` into `reports/errors.xlsx` |

Non-workspace tooling that lives alongside but isn't part of this Cargo workspace:
`scripts/replay` (bash + Python — replays DB passes against a local library-dump copy to diff two code
versions; see its own header comment for usage), `scripts/test-db` (bash — runs the full test suite
incl. `#[ignore]`d DB-integration tests against a disposable Postgres), `scripts/monitor` (unrelated
NAS-side helper scripts), `scripts/sql/*.sql` (one-off migrations and repair scripts, each with its own
header comment).

## `common`'s module shape

`common/src/lib.rs` re-exports these modules (all `pub mod`, ~4k lines total):

- `app` — shared process bootstrap: `spawn_shutdown_handlers` (see below).
- `lock` — the exclusive scan lock (see below).
- `db` — generic DB helpers used across crates (batch-insert/`UNNEST` patterns, etc).
- `mb/` — MusicBrainz client: `api` (HTTP + `RateLimiter`), `resolve` (artist-name resolution ladder),
  `cache` (`MbArtistLookup` read/warm), `names` (normalization), `allowlist` (release-group/status
  gating), `types` (response structs).
- `consensus` — the no-guessing unanimity gate (`docs/no_guessing.md`).
- `artists` — artist-name splitting/separator logic, `KNOWN_SINGLE_ARTISTS` backstop.
- `tags` — MP3/tag read-write, `Id3v2Tag`/`MbSlots` (never the generic lofty `Tag` — see
  `CLAUDE.md`'s MP3 note).
- `images` — cover/artist image fetch, resize, S3 upload.
- `s3` — S3 client wrapper.
- `config` — `web/.env` parsing shared by every binary.
- `filters` — `sanitize_mb_id` and similar small normalizers.
- `release_pairs` — title/runtime matching used by completeness scoring.
- `cleanup` — orphan sweep helpers (`delete_empty_releases`, `delete_orphaned_mb_releases`,
  `delete_orphan_artists`).
- `checkpoint` / `run_hash` — resumable-run state (a killed run resumes from where it left off).
- `progress` — `PROGRESS:{json}` emission for the web terminal (see below).
- `error_log` — `errors.log` read/write, shared path resolution (`dissect` reads what everyone else
  writes).
- `statistics` — `Statistics` singleton row (also where the scan lock lives).
- `slug` / `totals` / `types` — small shared utilities.

## Lock and bootstrap model

**The scan lock** (`common::lock`) is one exclusive lock in the `Statistics` singleton row
(`scanLockedBy`/`scanLockedAt`/`scanPid`). Every scan-locking binary calls `acquire_lock(pool, binary,
pid)` before doing any real work; failure to acquire prints `Cannot start: lock held by <binary> (pid
<pid>)` and exits. A background heartbeat refreshes the lock every 60s while held (`LockGuard`'s
`Drop` aborts the heartbeat task but does **not** itself clear the lock row — callers still call
`release_lock` explicitly). `STALE_LOCK_MINUTES = 3` tolerates two missed heartbeats before a
slow-but-alive process is treated as dead — long enough that a full-library `./tidy` run spanning hours
never self-evicts.

The web app reads the same row to decide whether a scan is running (`server/utils/scanLock.ts`) and
cross-checks the holder against `/proc/<pid>/comm` in its own PID namespace, since `scanPid` alone
can't distinguish a live process from a reused PID.

**Shutdown** (`common::app::spawn_shutdown_handlers`): every scan-locking binary spawns the same
Ctrl-C + SIGTERM pair. Either signal flips a shared `Arc<AtomicBool>` (`running`, `true` = keep going)
to `false`, prints a `Shutdown requested - finishing current <unit>...` message (`<unit>` is the
per-binary noun: "folder" for index, "artist" for sync, "phase" for add/tidy), releases the lock, and
exits. A second Ctrl-C force-exits immediately. SIGTERM's exit code differs by binary (0 for
index/sync, 1 for add/tidy) — established behavior, not a meaningful signal to build on. `running`
propagates by reference/clone into every worker task or loop; callers check `running.load(...)`
between units of work to stop promptly rather than only at binary exit.

**`PROGRESS:{json}` lines** (`common::progress`): with `--web` (or the equivalent per-binary flag),
each binary emits `PROGRESS:{...}` lines instead of pretty console output — this is what the web
terminal's SSE stream parses to drive progress bars (`server/utils/terminalCommand.ts`). A binary
without this flag defaults to human-readable console output. Anything printing raw progress numbers
outside this schema (or flooding it unthrottled, as `mosaic` once did per-image with no throttle) is
a UI-facing regression, not just a cosmetic one.

**`DMP_EXIT:<code>` sentinel** (`web/server/utils/terminalCommand.ts`): every terminal-run session's
wrapper shell traps `EXIT` and appends `DMP_EXIT:<code>` to the log file. The web app determines a
run's real exit status from this sentinel line in the log, never from tmux pane state or `tee`'s own
exit code — a `tee`-based exit check previously reported every crashed run as clean, since `tee` itself
exits 0 regardless of the piped command's exit code.

**`add`'s exit code 3** (`EXIT_ALREADY_EXISTS`, `add/src/main.rs`): distinct from exit 1 (generic
failure). Signals "this mbid/slug/folder already exists" so a caller (the web `/add` UI) can render
that case specifically instead of a generic error. See `docs/scripts/add.md`.

## Error-propagation policy

A DB/IO read whose result feeds a delete, write, or stamp must propagate its error, not swallow it —
silently continuing past a failed read that a later write depends on is how quiet data corruption
happens. This is applied throughout the workspace (see `docs/refactor.md`'s Phase 1A/1B sections for
the specific fixes that established it). The one deliberate exception is the **per-group error
boundary** pattern (`tidy`'s box-set repair, `boxset::run_repair`): a single group's write failure is
logged and counted, but must not propagate past that one group and abort every group still to come in
the same run — see `docs/sync_decisions.md` §9 "One box never blocks the rest" for why, and
`docs/history/sync_decisions_history.md` "Box-repair error boundary" for what happens when that
isolation is missing.

## Guardrails — contracts the web app depends on

These are load-bearing: changing any of them without updating the corresponding web-side code breaks
the terminal UI, lock detection, or the `/add` flow.

- `Statistics.scanLockedBy`/`scanPid` semantics and the `/proc/<pid>/comm` cross-check
  (`server/utils/scanLock.ts`).
- The exact `Cannot start: lock held by <binary> (pid <pid>)` message shape (parsed, not just
  displayed, in places that detect a lock conflict).
- `PROGRESS:{json}` line schema (`common::progress`, consumed by `server/utils/terminalCommand.ts`).
- The `DMP_EXIT:<code>` sentinel and the `trap ... EXIT` shell wrapper that emits it.
- `add`'s exit code 3 for "already exists" vs exit 1 for generic failure.
- `DESTRUCTIVE_FLAGS`/`COMMAND_PERM`/`FLAG_PERM` in `web/server/utils/terminalCommand.ts` — any new
  destructive CLI flag needs an explicit deny-list entry there, it is not inferred from the scripts
  side.

## Testing this workspace

- `scripts/check` — the full local gate: `cargo fmt --check`, `cargo clippy --workspace --all-targets
  -D warnings`, `cargo test` (unit only by default, `--db` also runs `#[ignore]`d integration tests),
  `./cli-contract check` (fails if a clap `--help` string drifted from its snapshot), the Prisma
  drift check, and the comment-neutrality gate (see `docs/refactor.md` Phase 5.3).
- `scripts/test-db` — spins up a disposable Postgres (or uses `TEST_DATABASE_URL` if already running
  one), applies Prisma migrations, runs the full suite including DB-integration tests. Never touches
  `DATABASE_URL`.
- `scripts/replay` — replays DB passes against a local copy of a library dump and diffs state between
  two code versions, for validating a matching-rule change before shipping it. See its own header
  comment for the `setup`/`run` subcommands; not duplicated here.
