# Scripts: mosaic

Tiles every release cover into one large mosaic image for `/labs/mosaic`. No project-root wrapper — the
web app spawns the binary directly from `POST /api/labs/mosaic/generate` (gated MANAGER+, one global
process at a time, 409 while one is running).

## Usage

```bash
scripts/target/release/mosaic --mode gradient
```

| Flag | Default | Description |
|---|---|---|
| `--image-dir` | `web/public/img/releases` | Source covers |
| `--output-dir` | `web/public/img/labs` | Where the mosaic JPEG is written |
| `--mode` | `chronological` | `chronological` \| `gradient` \| `random` |
| `--manifest` | - | JSON array of `{file, year}` entries; restricts the tile set and supplies the years |
| `--web` | false | Emit progress on stdout for the web terminal instead of stderr |

## Modes

- **chronological** — ordered by release year, read from the manifest.
- **gradient** — ordered by average tile colour converted to a warmth score.
- **random** — shuffled.

Without a manifest the binary scans `--image-dir` itself, and `chronological` has no years to sort by.
The API always writes a manifest first (`/tmp/mosaic-manifest-*.json`) from the DB.

## Grid

Columns/rows and tile size are derived from the cover count, so the output stays roughly square
regardless of library size. Covers are decoded in parallel (rayon) and encoded as JPEG.
