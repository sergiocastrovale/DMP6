# DMP Scripts

Rust CLI tools for managing the DMP music library. All scripts read configuration from `web/.env`.

Shell wrappers at the project root (`./sync`, `./analysis`, etc.) run `scripts/target/release/<name>`,
building it once if it is missing and `cargo` is available, and falling back to `docker exec dmp <name>`
on the NAS. An existing binary is never rebuilt automatically — after a code change run
`cd scripts && cargo build --release` yourself.

## Rust Scripts

| Script | Binary | Purpose | Docs |
|--------|--------|---------|------|
| `index/` | `index` | Extract metadata from local audio files, upsert to DB, resolve artist identity | [index.md](../docs/scripts/index.md) |
| `sync/` | `sync` | MusicBrainz sync for indexed artists | [sync.md](../docs/scripts/sync.md) |
| `tidy/` | `tidy` | Library-wide repair (box sets, identity, cleanup, re-score) after sync | [tidy.md](../docs/scripts/tidy.md) |
| `add/` | `add` | Add a MusicBrainz artist before any file exists for them | [add.md](../docs/scripts/add.md) |
| `audit/` | `audit` | Detect metadata issues → write to DB | [audit.md](../docs/scripts/audit.md) |
| `fix/` | `fix` | Apply PENDING issue fixes (tag writes + DB ops) | [fix.md](../docs/scripts/fix.md) |
| `problems/` | `problems` | Scan files for tag defects → XLSX, and fix year/artist/albumArtist defects | [problems.md](../docs/scripts/problems.md) |
| `analysis/` | `analysis` | Metadata quality scanner, generates HTML reports | [analysis.md](../docs/scripts/analysis.md) |
| `nuke/` | `nuke` | Full or partial database reset | [nuke.md](../docs/scripts/nuke.md) |
| `delete/` | `delete` | Permanently delete named artists + cascade | [delete.md](../docs/scripts/delete.md) |
| `playlists/` | `playlists` | Auto-generate genre + region playlists | [playlists.md](../docs/scripts/playlists.md) |
| `extract-meta-images/` | `extract-meta-images` | Extract embedded cover art to `folder.jpg` per release | [extract-meta-images.md](../docs/scripts/extract-meta-images.md) |
| `dissect/` | `dissect` | Parse `errors.log` into `reports/errors.xlsx` | [dissect.md](../docs/scripts/dissect.md) |
| `mosaic/` | `mosaic` | Build album-cover mosaics for `/labs/mosaic` (no wrapper — invoked by the web app) | [mosaic.md](../docs/scripts/mosaic.md) |
| `artist-photos/` | `artist-photos` | One-off backfill: fetch photos for photo-less artists | [artist-photos.md](../docs/scripts/artist-photos.md) |
| `common/` | — | Shared library: config, DB, MusicBrainz client + resolver, images, filters | — |

## Tests

```bash
cd scripts && cargo test --workspace   # unit tests
scripts/test-db                        # + DB integration tests against a throwaway Postgres (Docker)
DMP_LIVE_MB=1 scripts/test-db          # + tests that call the live MusicBrainz API
```

`scripts/test-db` starts a disposable `postgres:16`, applies the Prisma migrations and runs the whole
suite with `--include-ignored`. It never reads `DATABASE_URL`; `TEST_DATABASE_URL` points it at an
existing empty database instead.

### Replay (regression check against a copy of a real library)

```bash
scripts/replay/replay setup [dump.sql.gz]        # once: restore a ./backup dump into a local Postgres
scripts/replay/replay run before [--only "Name"] # clone it, run tidy + rescore + canonicalize, snapshot
# ...change code...
scripts/replay/replay run after [--only "Name"]
scripts/replay/replay diff before after           # id-free, per-table row diff
```

Runs entirely against a local container (port 55433) with storage/S3/music settings scrubbed from the
copy, binaries started outside the repo so `web/.env` is never read, and MusicBrainz traffic through a
caching proxy (`mb_proxy.py`) so repeat runs are deterministic. An unchanged tree must diff empty.

### CLI contract

`scripts/cli-contract check` compares every binary's `--help` with `scripts/tests/cli/*.help` — the web
app and wrappers depend on these flags. `update` rewrites the snapshots after an intended change.

`test-s3/` is a throwaway connectivity check for S3 credentials, not part of the workspace build.

## Bash Scripts

| Script | Purpose | Docs |
|--------|---------|------|
| `backup` | Pull a `pg_dump` + image archive from the NAS into `web/dump/` | [backup.md](../docs/scripts/backup.md) |
| `restore` | Load a dump from `web/dump/` into `RESTORE_DATABASE_URL` (never the live `DATABASE_URL`) | [backup.md](../docs/scripts/backup.md) |
| `refresh` (project root) | `index` then `sync`, piping artist IDs between them | [refresh.md](../docs/scripts/refresh.md) |
