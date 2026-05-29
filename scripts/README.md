# DMP Scripts

Rust CLI tools for managing the DMP music library. All scripts read configuration from `web/.env`.

Shell wrappers at the project root (`./sync`, `./analysis`, etc.) auto-build the Rust binary if `cargo` is available, or fall back to Docker for NAS deployment.

## Rust Scripts

| Script | Binary | Purpose | Docs |
|--------|--------|---------|------|
| `index/` | `index` | Extract metadata from local audio files, upsert to DB | [docs/scripts/sync.md](../docs/scripts/sync.md) |
| `sync/` | `sync` | MusicBrainz sync for indexed artists | [docs/scripts/sync.md](../docs/scripts/sync.md) |
| `audit/` | `audit` | Detect metadata issues → write to DB | [docs/scripts/audit.md](../docs/scripts/audit.md) |
| `fix/` | `fix` | Apply PENDING issue fixes (tag writes + DB ops) | [docs/scripts/audit.md](../docs/scripts/audit.md) |
| `analysis/` | `analysis` | Metadata quality scanner, generates HTML reports | [docs/scripts/analysis.md](../docs/scripts/analysis.md) |
| `nuke/` | `nuke` | Full or partial database reset | [docs/scripts/nuke.md](../docs/scripts/nuke.md) |
| `playlists/` | `playlists` | Auto-generate genre playlists | - |
| `delete/` | `delete` | Permanently delete a single artist + cascade | [docs/scripts/delete.md](../docs/scripts/delete.md) |

Build the full workspace:
```bash
cd scripts && cargo build --release
```

## Bash Scripts

| Script | Purpose | Docs |
|--------|---------|------|
| `backup` | Stream a compressed `pg_dump` from the NAS into `web/dump/` | [docs/scripts/backup.md](../docs/scripts/backup.md) |

