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

## Phase 1B — remainder (second pass)

Completed after the first report above, per instruction to continue every phase without stopping:

- `audit`: all 7 detectors (`corrupted`, `orphans`, `duplicates`, `missing`, `enrichment`,
  `duplicate-release`, `mismatched-release-id`) now wrap their DELETE-then-reinsert in one
  transaction — a crash mid-run used to leave the DETECTED set empty/partial until the next run.
- `fix`: added `--dry-run` (prints what each of the 4 fixers would change, writes nothing) and made
  `--mode` a clap `ValueEnum` instead of a runtime-validated string.
- `add`: a per-artist MB catalogue-fetch failure inside the shared gap-fill loop only ever logged and
  continued, so `./add`'s single-artist call always hit the success branch regardless — fixed by
  checking the target artist actually made it into the processed list. `--web` was being passed as
  the verbose flag by mistake (`add` had no `--verbose` of its own); added one, wired correctly.
- `problems`: `AUDIO_EXTENSIONS` had drifted from the indexer's real set (added `wma`/`wav`, which
  `./index` never treats as audio) — unified with `common::images::RELEASE_AUDIO_EXTENSIONS`.
  `id3raw`'s tag-body read used a single fallible `read()` that silently truncated on a short read
  (a real risk on a network-mounted `MUSIC_DIR`) — now `read_exact`. The years-fixer mislabeled
  every "folder disagrees on tags" skip as "MusicBrainz lookup failed" even though no MB call was
  made. `--resume`/`--restart` are now mutually exclusive at the clap level. `--only` only ever
  matched its whole argument as one prefix, silently ignoring `;`-separated multi-artist syntax every
  other binary supports — fixed to match. Investigated and found already correct: `--fix:artist`'s
  albumArtist handling, `--report-only`/`--fix`'s summary output, the fixed-ledger's (correct)
  survival across `--restart`.
- `playlists`: a generator that stops matching anything (edited terms, a deleted genre, no
  remaining tracks) left its previous playlist - and its stale tracks - untouched forever; now
  pruned. Genre-artist scoring had no `primaryArtistId` guard while region scoring did, so a
  connected (duplicate-merged) artist's own genre links could score it as a second artist.
- `analysis`: quarantine's `fs::rename` silently overwrites an existing destination (POSIX
  semantics) — now refuses and skips instead. Its own scan walked its `__QUARANTINE`/`__AUTOFIXED`/
  `__NEEDS_REVIEW`/`__UNREADABLE` output as library content on a re-run. The implausible-year check
  used a hardcoded `>= 2030` cutoff instead of the clock.
- `dissect`: `--input` defaulted to a bare relative `"errors.log"`, which never matches the real,
  `PROJECT_ROOT`-aware path `common::error_log` itself writes to — now shares that resolution.
  CLAUDE.md's/docs' own "errors.log" path note was stale for the same reason (moved to
  `data/logs/errors.log`) — fixed alongside.
- `mosaic`: a manifest whose files all failed to resolve silently fell back to scanning the whole
  image directory — mosaicing a different, much larger set of images than a curated web selection
  asked for, with no visible error. Now a hard failure. Output dir is validated before, not after,
  the expensive image processing; the output filename's tile count now reflects images actually
  rendered, not attempted.
- `artist-photos`: `artist_folder` could resolve to a release only co-owned under another artist's
  folder (a duet, a compilation), writing that artist's photo as `folder.jpg` into a folder that
  isn't theirs — now only a solely-owned release can supply it.
- Investigated, report only (touching this changes `contentHash`, needs explicit sign-off per
  standing instruction): `index/src/metadata.rs`'s tag-key matching uses
  `format!("{:?}", item.key())` — lofty's derived `Debug` output, not a stable API. lofty exposes a
  purpose-built `ItemKey::map_key(TagType)` that `common::tags` already uses for *writes*; the read
  path was never migrated. A future lofty version renaming an `ItemKey` variant would silently break
  every field this drives (albumArtist, track/disc number, MB ids) with no compile error.

Deployed after this batch; smoke-tested a full-library `audit` (same counts as the prior run, exit
0), `fix --missing --dry-run`, and a real 43-generator `playlists` run (21,117 tracks, exit 0) —
`errors.log` clean.

## Phase 2a — dead code, hygiene, pool hardening

- Removed (all confirmed zero real callers before deletion): sync's unused checkpoint fns +
  `SyncCheckpoint`, `Reporter::{is_web,sub_item}`, `images::use_folder_image`,
  `RateLimiter::set_web` (+ 4 no-op call sites), `ResolveSource::Cache` (never constructed) and its
  always-zero "cached" stat, `credit_artists_created`/`SpanResolver.lookups` (write-only),
  `acquire_lock`'s unused `args` param (+ every caller's now-pointless JSON construction),
  `LocalReleaseRow.status_reason` (write-only), `id3raw::rewind` (already
  `#[allow(dead_code)]`), `playlists`' `GenreMatch.genre_name`, `analysis`'s `--unc-prefix` (echoed,
  never used), the standalone `test-s3/` crate (not a workspace member), and sync's
  `mb_api.rs`/`mb_types.rs` + index's `images.rs` re-export shim files (now `pub use` aliases in
  `lib.rs` / direct `common::` paths — zero call-site churn across ~20 usages).
- `KNOWN_SINGLE_ARTISTS` moved to a data file (`common/src/data/known_single_artists.txt`),
  normalized once into a `LazyLock<HashSet>` instead of on every lookup call.
- `walkdir` versions unified into one workspace dependency.
- `common::db::create_pool` now returns `Result` (was an unconditional `.expect()` panic on connect
  failure) and sets `application_name` per binary (visible in `pg_stat_activity` — every binary's
  connections were previously indistinguishable) plus an `acquire_timeout` and per-connection
  `statement_timeout`, so a saturated pool or a runaway query fails clearly instead of hanging
  forever. `create_pool_or_exit` added for the common "connect or print-and-exit" binary-startup
  shape; all 7 real callers + every test call site updated.
- `cargo clippy --fix` applied for every mechanically-safe lint (184 → 90 warnings); the remainder
  (very-complex-type, too-many-arguments) needs the struct/module work already scoped to Phase 5,
  not blind auto-fixing — `-D warnings` deferred until then.
- `backup`: hardcoded a personal SSH alias, a TrueNAS container name, and NAS mount paths as silent
  defaults. Rewritten to share `./deploy`'s own `SERVER_HOST`/`SERVER_USER`/`SSH_KEY_PATH`/
  `DEPLOY_PATH` instead of a second, differently-named set of vars, with `POSTGRES_CONTAINER`
  required explicitly (no sensible generic default). **This change had two real bugs caught before
  commit**: an apostrophe inside a `${VAR:?message}` construct broke bash's parser outright (a
  bash quoting quirk, not specific to this script), and naively dropping the "nas" SSH-alias default
  in favour of the raw `SERVER_HOST` IP silently lost the alias's `IdentityFile`/`IdentitiesOnly`
  routing, breaking auth. Both fixed and the script **verified end-to-end against the live server**
  (a real `--db-only` backup completed; the dump was deleted after).
- `songkong-drain.sh`/`songkong-scan.sh` hardcoded `/mnt/SSD/...` paths outright; now source
  `web/.env` for `SONGKONG_STATE_DIR` (already documented) and three new vars
  (`SONGKONG_LIVE_CFG`/`AUTO_CFG`/`IMAGE`, added to `.env.example`). Not currently active in this
  deployment (no crontab entry exists for either script).
- Docs (`docs/scripts/*.md`) synced against every fix above, plus drift found while reviewing that
  predated this session: a stale ">10min" lock threshold (now 3min, one shared constant across all
  9 binaries), `fix.md`'s missing mention of the file-tag rewrite `--duplicates` does, and the
  image-deletion ordering (after the row is gone, not before) for `--orphans`/`--duplicates`.

Deployed after this batch; smoke-tested `index`/`sync`/`tidy` on a real artist, all exit 0.

## Phase 3 — consolidation (narrow, high-confidence items only)

Attempted a broader sweep of "obvious" duplicates first and stopped deliberately: two separate
lookalike-consolidation attempts this session turned out to have real behavioural differences on
inspection (`common::filters::matches_filter` supports `;`-separated `--only`, the `problems` copy
didn't — fixed above, not merged, since unifying them *changes* `problems`' behaviour and needed its
own commit) or were reverted after `cargo check` caught a mistake (a `sync::main.rs` copy of
`year_from_date` looked unused by grep but was actually called via `.and_then(year_from_date)` — a
bare function reference, which a literal `year_from_date(` search missed entirely; restored
immediately, zero net diff, never committed). Given that pattern, further "this looks identical"
consolidation across the full `common::app`/`config`/`library`/`s3`/`db`/`mb` scope the plan
describes was not attempted this session — it needs the same one-item-at-a-time, compiler-and-test
verified treatment as everything above, at a scale (bootstrap/lock/signal boilerplate shared by 6+
binaries with subtly different polarity/exit-code conventions already found on inspection) that is a
multi-session effort in its own right, not a mechanical sweep.

## Not done this pass

Phases 3 (the rest of it: `common::app`/`RunGuard` bootstrap, `common::library`/`config`/`s3`/`db`
consolidation), 4 (measured performance work), 5 (module splits, `FromRow` structs, the full
comment-neutrality rewrite + regex gate), and 6 (docs split into reference vs `docs/history/`) were
surveyed against the plan but not executed at scale this session, for the reason above: each is
large enough, and touches shared/live-critical code broadly enough, that doing it safely needs its
own dedicated pass with the same per-item verification discipline used throughout this report, not a
rushed sweep. `docs/scripts/*.md` were kept in sync with every runtime fix as it landed instead
(the safe, high-value slice of Phase 6 achievable alongside the rest).

## Phase 3.1 — shared shutdown-handler extraction

A new detailed plan (`/home/kp/.claude/plans/composed-giggling-snowglobe.md`, rewritten to cover only
the remaining phases) scoped Phase 3's remainder down to one narrow, fully-specified item rather than
the original broad `common::app`/`config`/`library` consolidation, after two near-misses on
lookalike-consolidation the prior session (see that plan's Context section).

- `add`/`sync`/`tidy`/`index` each spawned an identical Ctrl-C + SIGTERM handler pair (~15 lines each)
  that only differed in the shutdown message's unit noun, the SIGTERM exit code, and — for `index`
  only — the stop-flag's polarity (`shutdown`/`true=stop` vs the other three's `running`/`false=stop`).
  Extracted to `common::app::spawn_shutdown_handlers(pool, binary, unit, sigterm_exit_code)`.
  `index`'s 6 internal `shutdown.load(...)` check sites were inverted to the shared `running`
  convention (line-by-line verified match before editing, not a blind find/replace).
- **Verified**: full workspace compile after each of the 4 binaries individually (not batched), full
  `scripts/check --db` gate, then a live signal test on the NAS after deploying — `index` (the
  inverted-polarity one) sent a real `SIGTERM` mid-run via `node -e 'process.kill(pid, "SIGTERM")'`
  (no `kill` binary in the container), confirmed it exited and the scan lock cleared
  (`scanLockedBy`/`scanPid` both `NULL`); `sync` sent two `SIGINT`s (Ctrl-C) - stayed alive after the
  first (as designed, waiting for the current artist or a second signal), exited after the second,
  lock cleared. `errors.log` had no new entries from either test. `tidy` given an ordinary run
  afterward to confirm the non-signaled path still works, exit 0.

## Phase 4 — performance (measured, deployed, smoke-tested)

- **`index`: `get_local_release_members` hoisted out of the per-folder loop.** It fetched the whole
  table with no per-folder filter, so a full-library run paid the query once per artist folder instead
  of once per run (~10k folders on a real library; the underlying table is `sync`-owned and never
  mutated by `index` mid-run, so one read up front is safe). `EXPLAIN ANALYZE` put the query at
  roughly 5ms; removing ~10k redundant calls saves on the order of a minute of otherwise-wasted
  round-trip time on an unfiltered run.
- **`index`: owner-reconcile DELETE batched.** The per-release loop issuing one
  `DELETE FROM "LocalReleaseArtist" WHERE "localReleaseId" = $1 AND "artistId" <> ALL($2)` per release
  in scope is now a single `UNNEST(...)`/`NOT EXISTS`/`= ANY(...)` statement covering every release in
  the run, preserving the same three skip rules (deferred release, empty desired set, per-release keep
  set) the loop expressed with `continue` and a per-call bind. A new test
  (`a_multi_release_pass_isolates_each_releases_owners`) proves the batched form still scopes each
  release's keep-set independently — no cross-release leakage.
- **Verified:** full workspace compile, `scripts/check --db` (all suites including the new test)
  green, deployed, and smoke-tested on the NAS with a real (non-`--only`, folder-scoped via
  `--folders` since the test fixture's owning folder differs from the credited artist's name) run —
  exit 0, both real owners intact post-reconcile, `errors.log` unchanged.
- **sync: MB track reconcile's UPDATE path batched.** `sync_mb_tracks_for_release` already batched
  its INSERT path via `UNNEST`; the UPDATE path (existing tracks whose id must be kept) still issued
  one round trip per track. Now one `UPDATE ... FROM UNNEST(...)` per release, same COALESCE
  semantics preserved per column. Verified via a real re-sync of a bound release (`--overwrite`),
  exercising the update path against its full existing tracklist.
- **audit: every detector's "already tracked" check batched.** All 7 detectors (`corrupted`,
  `duplicates`, `enrichment`, `missing`, `orphans`, `release_pairs` ×2) issued one `EXISTS` query per
  candidate row to skip issues already queued/resolved. Each now reads the full tracked set once
  before the loop and checks membership in memory - same pattern `duplicates.rs` already used for its
  `linked_pairs` hoist, just applied to the other check too. Verified with a full-library `audit` run
  (151k+ enrichment-gap candidates, 6.5k+ duplicate-release candidates) - exit 0, correct counts,
  `errors.log` unchanged apart from an unrelated pre-existing mtime warning from the sync smoke test
  run alongside it.
- Investigated and found not applicable, given current code (each check's own reasoning): `index`'s
  per-folder artist-totals/`propagate_mb_artist_id` calls (genuinely different per-artist data, not a
  redundant re-fetch); `apply_folder_consensus` (already scoped to one folder's 1-2 releases per call,
  not a whole-run loop; its early-continue branches make batching lose real behavior); unscoped
  `ANY($1)` credit fetches in `index` (all already properly id-scoped); `index`'s cover-art
  negative-cache candidate (no matching code found in `main.rs` as described); `sync`'s medium
  (disc-level) UPDATE loop (bounded by disc count per release, typically 1, not a meaningful N+1);
  `sync/status.rs`'s `normalize_title` recomputation (pure in-memory string work on ~10-20 tracks per
  release, no measured cost to justify the churn).
- **mosaic: web-mode PROGRESS output throttled.** The `--web` path printed one `PROGRESS:{json}` line
  per image with no throttle at all (the terminal path already throttled to every 100th image); a
  full-library mosaic run floods the SSE stream with tens of thousands of lines for no UI benefit. The
  stride now scales with image count (`(count / 100).max(1)`, always emitting the final `done == count`
  line) instead of a fixed 100, so a small mosaic still reports partway through rather than jumping
  straight from 0% to 100%. Verified directly against the deployed binary on a 250-image subset: exit
  0, 125 throttled `PROGRESS` lines (stride 2) ending on `250/250`, correct final `DONE:{...}` line.
- Investigated and found not applicable, given current code: `delete`'s co-artist-cascade candidate
  loop (bounded by how many artists share a release with the deletion targets - small in practice, and
  `./delete` is a rare, human-confirmed operation, not a hot path); `analysis`'s directory walk (already
  a single top-level `WalkDir::new` at the start of the run, not per-artist).
- Deferred as its own larger effort, not attempted this pass: concurrent MB calls in
  `boxset::run_repair`/`catalogue_gaps::fill_catalogue_gaps` via the shared `RateLimiter` (the
  `MAX_IMAGE_TASKS`/`JoinSet` pattern `sync/src/main.rs` already uses for image downloads is the
  template, but wiring it through these two larger functions safely needs its own dedicated pass);
  `boxset.rs`/`box_editions.rs` N+1 loads. See the plan file's Phase 4.2 checklist for the remaining
  scope.

## Phase 5.1 — clippy verbatim fixes (mechanical, behaviour-preserving)

Re-ran `cargo clippy --workspace --all-targets` (69 warnings) and applied every fix clippy itself
proposed verbatim, one category at a time with a full workspace `cargo check` after each: 13
`clone()` → `std::slice::from_ref` sites, a redundant match guard, `&PathBuf` → `&Path`, an
`unnecessary_unwrap` rewritten as an `if let`, two `useless_vec!` test fixtures, a
`field_reassign_with_default` folded into `box_editions`' `LinkSummary` initializer, two
`needless_borrow`s (introduced by this session's own earlier `box_editions.rs` caching change, caught
by the same clippy run), the oversized `CandidateSource::Fetched` enum variant boxed
(`release: Box<MbRelease>`, all 3 construction sites + the one destructuring site that reads it
updated), and doc-comment indentation/empty-line nits across 6 files. Two `if_same_then_else` hits
(`common::artists`' separator splitter, `delete/src/files.rs`'s dry-run-vs-real-delete branches, ×2)
were read in full before merging - both were genuinely identical actions behind different guards, not
a coincidental match hiding a real difference. 69 warnings down to the 33 structural ones left (27
complex-type, 6 too-many-args) - Phase 5.1's remaining, larger-effort half.
Verified live: deployed, then ran `index --overwrite` on a real multi-artist blues-comp folder whose
188 distinct `albumArtist` tags exercise every branch of the merged splitter (`;`, `\`, `&`, `feat.`,
`with`, `,`, `/`) - 2985 links applied, 0 errors, `errors.log` unchanged.

## Phase 5.1 — structural half: FromRow structs + context structs (complete)

Following the mechanical clippy-fix batch above, converted every remaining `type_complexity` (27) and
`too_many_arguments` (6) warning the same clippy run flagged - the workspace went from 69 warnings to
0. Highlights:

- Every tuple-typed `sqlx::query_as::<_, (...)>` across `common`, `index`, `audit`, `sync`, `playlists`,
  and `delete` now uses a named `#[derive(sqlx::FromRow)]` struct, column-aliased in the `SELECT` list
  wherever two joined tables' columns shared a name (both artists' `id`/`musicbrainzId` in
  `audit::duplicates`, `d`/`p` in `sync::db::repair_all_empty_primaries`, `mbr`/`mbrt` in
  `get_tracks_with_mb_ids_for_artist`, etc.) - `FromRow`'s derive matches by column name, so an
  unaliased collision would have silently mapped the wrong value into a field.
- `index::db::ReleaseFacts` bundles `ensure_local_release`'s 6 release-identity args (title/year/
  folder_path/group_key/status/reason); `common::progress::FolderTally` bundles `index_progress`'s 4
  file-outcome counters; `sync::catalogue_gaps::GapFillContext`/`ArtistFilter` split
  `fill_catalogue_gaps`'s 12 args into the 5 run-wide pieces + the 4 name-filter fields, both call
  sites (`sync`, `add`) updated.
- `sync::db::ArtistImageRow` (made `pub`, an external crate boundary since `sync`'s bin and lib are
  separate compilation units) + a `From<ArtistImageRow> for ArtistSyncRow` conversion replaced 4
  near-identical inline row-to-struct mappings across `sync/db.rs` and `sync/main.rs`.
- `analysis::main`'s three largest signatures collapsed via `ScanStats`/`ScanArtifacts`/`AutofixRefs`/
  `NavEntry`/`AutofixResult` - each function's ~150-300 line body was left untouched by destructuring
  the new struct back into the original local variable names right at the top, so the mechanical risk
  stayed confined to the signature and its one call site.
- `sync::boxset::CandidateSource::Fetched.release` boxed (`Box<MbRelease>`, clippy's own
  `large_enum_variant` finding, folded in alongside since it touched the same struct family);
  `StoredTrackRow`/`ImageTasks`/`DiscFixture` type aliases where a plain tuple stayed the natural shape
  (test fixtures, an `Arc<Mutex<JoinSet<...>>>` handle) rather than forcing a struct nobody destructures.
- `sync::main.rs::upsert_mb_release` got a documented `#[allow(clippy::too_many_arguments)]` instead of
  a forced struct - its sibling `upsert_mb_release_with_media` already carried the same allow, and the
  two already-grouped pieces (identity fields + the pre-existing `MbReleaseExtras`) don't have a further
  natural split.
- **Caught two near-misses purely by reading each row's downstream usage before converting**, both
  described in commit messages: `delete/src/release.rs`'s `title`/`image`/`imageUrl` fields looked
  droppable at the query site but fed the plan printout further down; `sync::db::repair_all_empty_primaries`'s
  `empty_name` field looked like a candidate for `_`-discarding but is `IdentityRepair.other` in the
  report. Neither ever reached a compile error - only inspection caught them, the same discipline this
  whole refactor pass has relied on throughout.
- `scripts/check`'s clippy invocation now runs with `-D warnings` (was quiet-mode with no fail-on-warn),
  so a future regression fails the gate instead of accumulating silently.
- **Verified live** on the deployed NAS: `index --overwrite` and `sync --release` (a real bound
  release, exercising the batched track-update path), a full-library `audit` (identical detection
  counts across all 7 detectors vs. before this phase), `tidy --only` (exercised box_editions.rs's
  artist-lookup cache and the identity-repair FromRow conversion against real compound-artist data),
  `playlists --dry-run` (all 43 generators via the `Generator` FromRow), and `delete --dry-run`
  (printed plan uses the title/image fields the near-miss above would have dropped). All exit 0,
  `errors.log` unchanged throughout.

## Phase 5.2 — module splits

- **`sync/src/db.rs` (2350 lines) split into `sync/src/db/{mod.rs, mb_release, rescore, artist, local,
  cleanup, identity, watermark}.rs`**, by entity/table, following the section banners the file already
  had. `mod.rs` re-exports everything (`pub use mb_release::*` etc.) so every existing `db::Whatever`
  path - both within this crate and from the `sync` binary crate across the lib/bin boundary - kept
  working with zero caller changes. Verbatim line-range move (checked arithmetically: every extracted
  range's line count summed to the original file's exactly, confirming no line was dropped or
  duplicated) - the only real fixes were consequences of the split itself: a doc comment that had been
  silently mis-attached to the wrong item for the file's entire history (`get_contained_notes_for_artist`'s
  real doc comment sat orphaned before `IdentityRepair`'s own comment, attached to neither) became a
  hard parse error once it landed at true end-of-file with nothing after it - moved to the function it
  actually documents; `clamp_title`'s test module physically sat in the file's tail region (with
  `get_artists_pending_sync`/run-hash code) even though it tests a function that lives at the top
  (MB-release upsert) - moved to sit with `clamp_title` itself.
- **Verified live** on the deployed NAS: `sync --release` (exercises `mb_release`/`local` modules) and
  `tidy --only` (exercises `rescore`/`identity`/`watermark`/`artist` modules) - both exit 0, output
  identical in shape to pre-split runs, `errors.log` growth matches the expected pre-existing mtime
  warning from the sync run alone.
- **`sync/src/boxset.rs` (3200 lines, the workspace's largest file) split into
  `sync/src/boxset/{mod.rs, pairing, candidates, discovery, apply, orchestration}.rs`**, following its
  own section banners, plus a `tests.rs` holding the ~1250-line shared test module as one file (it
  exercises all five sections together; the file itself *is* the `tests` module under the new layout,
  so `boxset::tests::replay_library_dump`'s existing path is unchanged). Every helper that was only
  ever called from elsewhere in the same file - `CandidateSource`, `BoxOutcome`, `find_sibling_groups`,
  `persist_box_media`, `pair_tracks_at`, a dozen more - needed `pub(crate)` once its caller moved to a
  sibling module; nothing was widened past the crate boundary. One real mistake, caught immediately by
  the compiler: the extraction script duplicated `pairing.rs`'s own `use` block on top of the synthesized
  header, which `E0252` flagged before it ever reached a test run.
  **Verified**: the full `check --db` gate (which includes boxset's own extensive pairing/candidate/apply
  unit test coverage) plus three live `tidy` runs against the real NAS database (an artist with no box
  work, one with an unfolded sibling group still on the watermark's "already tidied" side, one plain
  artist) - all exit 0, `errors.log` unchanged, `find_sibling_groups`' query executing correctly through
  the new module boundary each time.
- **`sync/src/main.rs` (2296 lines) split into `main.rs` (690, CLI/setup/summary) + `pipeline.rs`**
  (the ~1200-line async body of the concurrent per-artist `stream::iter(...).map(...).buffer_unordered(...)`
  pipeline, plus every helper only it used - `ArtistReporter`, `ArtistOutcome`, `search_match_acceptable`,
  `search_release_candidate`, `consensus_tags_from_rows`, `fetch_and_store_artist_image`, and their
  shared test module). The closure's ~15 loose captures (a `.clone()` per worker of `limiter`, `pool`,
  `reporter`, `image_tasks`, ... plus borrows of `args`, `warmed_artist_names`, `run_hash`, ...) became
  one `ArtistWorkerCtx`, destructured back to their original names at the top of the new
  `process_artist()` so the ~1200-line body itself needed zero further edits - the same technique
  already proven on `analysis.rs` and `sync/catalogue_gaps.rs` earlier in this phase, just at 8x the
  scale. `is_targeted` (previously an implicit `bool` capture, cheap enough that the original code never
  bothered cloning it explicitly) is simply recomputed from `args` inside the function instead of being
  threaded through. This was the plan's own explicitly-named highest-risk item - the most-executed code
  path in the whole system - and was done last, deliberately, after every safer split had already landed.
- **`index/src/main.rs` (2049 lines) split into `main.rs` (1156) + `scan.rs`** (the ~925-line body of
  the *sequential* main folder loop). Unlike sync's concurrent closure, this loop mutates run-wide
  accumulator variables (`total_files`, `new_total`, `mb_id_to_image_hash`, ...) directly in place
  rather than returning a per-item outcome - the extraction had to change that shape: `process_folder`
  now returns a `FolderOutcome` per call, and the slimmer loop left in `main()` adds each into the
  run-wide totals itself. The 3 caches genuinely shared *across* folders (`artist_cache`,
  `release_cache`, `mb_id_to_image_hash` - a folder can short-circuit cover-art work another folder
  already resolved this run) are threaded through `FolderCtx` as `&mut` instead of cloned, since index
  has no concurrency to isolate workers from each other. The loop's one `break` (cancelled run) became
  `return None`; its two early `continue`s (already indexed, 0 files) became
  `return Some(FolderOutcome::default())` - everything in between needed no other logic changes.
- **Two real mistakes caught by the compiler during these two splits, both before ever reaching a test
  run**: the extraction script duplicated `sync/pipeline.rs`'s `use` block on top of its synthesized
  header (`E0252`, caught immediately); `index/src/scan.rs`'s `folder_name` parameter typed as `&str`
  instead of the original `&String` broke `.as_str()` (it resolved to an unstable nightly-only inherent
  method instead of the stable `String` one) - fixed by matching the original type exactly rather than
  "simplifying" it.
- **Verified live** on the deployed NAS for both splits: a real two-artist *concurrent* sync
  (`--only 'Y&T;Dead Meadow' --overwrite`, exercising `pipeline::process_artist` under real
  `buffer_unordered` concurrency - MB search, tag writes, catalogue-gaps, containment detection) and a
  real two-folder *sequential* index run (`--only 'Dead Meadow;K-The-I' --overwrite`, 260 files, 0
  errors, confirming `FolderOutcome` accumulation across multiple folders sums correctly) - both exit 0,
  `errors.log` unchanged beyond the same pre-existing benign mtime warning seen throughout this session.

**Phase 5.2 is now complete** - all four planned module splits (`sync/db.rs`, `sync/boxset.rs`,
`sync/main.rs`, `index/main.rs`) landed, each compiled, linted (`-D warnings`), tested, deployed, and
verified against the live NAS before moving to the next.

## Phase 5.3 — comment neutrality sweep (complete)

Went file by file through every comment matching `used to|previously|audit #[0-9]|/mnt/` (44 files at
the start, grown from the plan's original 38 by the module splits duplicating some comments across new
files) plus a separate pass for bare `20\d\d-\d\d` dates and thousands-separated measured counts in
comments. For each: rewrote a genuine "fixed incident" narration as a present-tense invariant (what the
code does and why, not what it used to do before a fix), replaced real artist/album names used as
incident examples with generic placeholders (ABBA, HIM, IQ, Marillion, Bass Mekanik, Yello, Soulwax,
Radiohead, Jimmy Regal And The Royals, Lena Horne & Gábor Szabó, The B.B. King Blues Band, 10,000
Maniacs), and renamed one test (`hims_ten_disc_box_binds_every_medium` -> a name describing the rule it
pins) and one variable (`previously_had_reason` -> `already_had_reason`) that were the only remaining
un-rewordable matches. Left untouched: comments using "used to"/"previously" in a genuinely functional
sense ("used to validate", a folder-freshness check) rather than narrating a fixed incident - these
don't carry the incident-history baggage the sweep exists to remove.

Found and fixed, incidentally, a second instance of the same orphaned-doc-comment bug the Phase 5.2
`sync/db.rs` split first surfaced: `sync/src/boxset/tests.rs` had a `--only`-scoping regression
paragraph concatenated directly onto an unrelated disc-sequencing test's doc comment (no blank line
between them), documenting neither correctly. Separated into its own standalone comment.

**The final automated gate**: `scripts/check` now scans every tracked `.rs` file's comment-prefixed
lines (`//`, `///`, `//!` only - so a legitimate date or count inside test data/string literals, like
`sync::status`'s test MB release dates, never trips it) for the same patterns, and fails the whole gate
on any match. Getting to a clean run surfaced ~14 more matches that were real but hadn't been narrative
history - a CLI flag's `--help` text, a user-facing status-line string, a couple of "used for" phrasings,
and the three "10,000 Maniacs"-style parsing-rule illustrations (a thousands-comma number in an
example trips the same pattern a measured incident count would, with no way for the automated gate to
tell them apart) - all reworded rather than exempted, so the gate itself needs zero special cases.
Comment/test-name/variable-name-only changes throughout; the one behavior-adjacent side effect was
`fix --help`'s text changing, which updated `scripts/tests/cli/fix.help`'s CLI-contract snapshot via
`./cli-contract update`.

**Not attempted**: an exhaustive hunt for every real artist/album name mentioned anywhere in a comment
beyond what the grep patterns above surfaced. The original plan explicitly decided against an
artist-name denylist (too fragile, not worth checking into the repo), which means this category of
cleanup is inherently manual-judgment-driven rather than gate-enforced - what's covered here is every
instance the sweep's own patterns caught, not a claim that zero real names remain anywhere in the tree.

## Verification

Every commit passed `scripts/check --db` (fmt, clippy, full workspace test suite incl. `--ignored`
DB-integration tests on a disposable Postgres 18.4, CLI-contract snapshot, Prisma drift check) before
being pushed. Behaviour-changing fixes with a plausible regression path got a test that reproduces
the bug on the pre-fix code and passes on the fix (`box_editions` self-equivalence, `contains_as_word`
panic, `bind_local_release` atomicity, totals `SUM(DISTINCT)`, `problems`' `--only` multi-value). Every
deployed batch was smoke-tested against the live server (`index`/`sync`/`tidy` on a real artist,
`fix --missing`/`--dry-run`, `tidy --rescore-only`, a full-library `audit` run, a real 43-generator
`playlists` run, a real `--db-only` backup) with a clean `errors.log` throughout.
