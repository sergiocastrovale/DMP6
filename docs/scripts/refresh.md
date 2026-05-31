# Scripts: refresh

Combines `index` and `sync` into a single command. Handles the folder-name-to-artist-name mismatch: index filters by filesystem folder names, sync filters by DB artist names. When scope filters are present (`--only`, `--from`, `--to`, `--folders`), refresh pipes the exact artist IDs from index to sync via a temp file, so sync always processes the correct artists regardless of naming differences.

## Build

```bash
cd scripts && cargo build --release
```

## Usage

```bash
./refresh                          # Full: index all, then sync all pending
./refresh --only "radiohead"       # Index folder "radiohead", sync the DB artists found in it
./refresh --only "Name" --exact    # Exact folder match
./refresh --from "A" --to "M"     # Letter range
./refresh --release "clxxxxxxx"   # Re-index + re-sync a single release
./refresh --overwrite              # Force re-index + re-sync all
./refresh --only "Name" --overwrite  # Force re-index folder + force re-sync its artists
```

## How It Works

**Without scope filters** (`--only`, `--from`, `--to`, `--folders`):
- Passes all args to both `index` and `sync` unchanged (original behavior)

**With scope filters:**
1. Runs `index` with all args + `--emit-artist-ids <tempfile>`
2. Index processes matching folders, writes all discovered artist IDs to the temp file
3. Strips scope filters (`--only`, `--from`, `--to`, `--folders`, `--exact`) from sync args
4. Runs `sync` with `--artist-ids <tempfile>` + remaining args (e.g. `--overwrite`, `--web`)
5. Sync queries artists by primary key — no name matching needed

This solves the common case where a folder name differs from the DB artist name (e.g., folder `"the 101 strings orchestra"` → DB artist `"101 strings"`).

## Arg Routing

| Arg | Passed to index | Passed to sync |
|-----|----------------|----------------|
| `--only` / `-o` | Yes | Stripped (replaced by `--artist-ids`) |
| `--from` / `-f` | Yes | Stripped |
| `--to` / `-t` | Yes | Stripped |
| `--folders` | Yes | Stripped |
| `--exact` | Yes | Stripped |
| `--release` | Yes | Yes (pass-through, no scope issue) |
| `--overwrite` | Yes | Yes |
| `--web` | Yes | Yes |
| All other flags | Yes | Yes |

## Binary Resolution

The script resolves `index` and `sync` binaries flexibly:
- First tries `$SCRIPT_DIR/index` (project root, where shell wrappers live)
- Falls back to `index` on PATH (Docker, where binaries are installed to `/usr/local/bin/`)
