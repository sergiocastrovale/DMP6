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
| `common/` | — | Shared library: config, DB, MusicBrainz client + resolver, images, filters | — |

`test-s3/` is a throwaway connectivity check for S3 credentials, not part of the workspace build.

## Bash Scripts

| Script | Purpose | Docs |
|--------|---------|------|
| `backup` | Pull a `pg_dump` + image archive from the NAS into `web/dump/` | [backup.md](../docs/scripts/backup.md) |
| `restore` | Load a dump from `web/dump/` into local PostgreSQL | [backup.md](../docs/scripts/backup.md) |
| `refresh` (project root) | `index` then `sync`, piping artist IDs between them | [refresh.md](../docs/scripts/refresh.md) |
