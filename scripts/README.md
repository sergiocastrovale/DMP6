# DMP Scripts

Rust CLI tools and Python helpers for managing the DMP music library. All scripts read configuration from `web/.env`.

Shell wrappers at the project root (`./sync`, `./analysis`, etc.) auto-build the Rust binary if `cargo` is available, or fall back to Docker for NAS deployment.

## Rust Scripts

| Script | Binary | Purpose | Docs |
|--------|--------|---------|------|
| `sync/` | `dmp-sync` | Index local audio files + sync against MusicBrainz | [docs/scripts/sync.md](../docs/scripts/sync.md) |
| `analysis/` | `analysis` | Metadata quality scanner, generates HTML reports | [docs/scripts/analysis.md](../docs/scripts/analysis.md) |
| `clean/` | `dmp-clean` | Process S3 deletion queue for orphaned images | [docs/scripts/clean.md](../docs/scripts/clean.md) |
| `nuke/` | `dmp-nuke` | Full or partial database reset | [docs/scripts/nuke.md](../docs/scripts/nuke.md) |
| `audit/` | `dmp-audit` | Data integrity audit, exports XLSX report | [docs/scripts/audit.md](../docs/scripts/audit.md) |
| `delete/` | `dmp-delete` | Permanently delete a single artist + their catalogue, with cascade to ghost co-artists | [docs/scripts/delete.md](../docs/scripts/delete.md) |

Build any Rust script with:
```bash
cd scripts/<name> && cargo build --release
```

## Python Helpers

Used during the [post-sync routine](../docs/post_sync.md) to fix MP3 tag issues found by sync.

| Script | Purpose | Docs |
|--------|---------|------|
| `fix_sync_errors.py` | Parse `errors.log` and fix broken MP3s by category (encoding, corrupt frames, missing tags) | [docs/scripts/helpers.md#fix_sync_errorspy](../docs/scripts/helpers.md#fix_sync_errorspy) |
| `check_ampersand_artists.py` | Detect compound artists (`&`, `/` in name) that should be split | [docs/scripts/helpers.md#check_ampersand_artistspy](../docs/scripts/helpers.md#check_ampersand_artistspy) |
| `fix_compound_artists.py` | Fix known compound artist tags by replacing separators with `\\` | [docs/scripts/helpers.md#fix_compound_artistspy](../docs/scripts/helpers.md#fix_compound_artistspy) |
| `fix_compound_tpe2.py` | Fix compound TPE2 tags library-wide (DB-driven, all ambiguous separators) | [docs/scripts/helpers.md#fix_compound_tpe2py](../docs/scripts/helpers.md#fix_compound_tpe2py) |
| `missing_metadata_report.py` | Query DB for tracks missing mood/BPM/AcoustID, export XLSX | [docs/scripts/helpers.md#missing_metadata_reportpy](../docs/scripts/helpers.md#missing_metadata_reportpy) |

## Bash Scripts

| Script | Purpose | Docs |
|--------|---------|------|
| `backup` | Stream a compressed `pg_dump` from the NAS into `web/dump/` | [docs/scripts/backup.md](../docs/scripts/backup.md) |

## Other

| File | Purpose |
|------|---------|
| `_docker_run` | Shared helper sourced by wrapper scripts for Docker-based execution on the NAS |
| `Dockerfile` | Multi-stage build for the `dmp-scripts` Docker image |
