# Scripts: symlink-test-artists

Creates symlinks from `MUSIC_DIR` into `web/dump/test-artists/` for a curated list of artist folders. Used with `./sync --test` to run against a small subset of the library.

## Usage

```bash
./symlink-test-artists        # Create symlinks
./sync --test                 # Sync only test artists
./sync --test --overwrite     # Nuke + re-sync test artists
```

## Configuration

Edit the `ARTISTS` array in the script to add/remove folders:

```bash
ARTISTS=(
    "070 Shake"
    "Radiohead"
    "Kool & the Gang"
)
```

Reads `MUSIC_DIR` from `web/.env`. Each entry must match an existing folder name in `MUSIC_DIR`.
