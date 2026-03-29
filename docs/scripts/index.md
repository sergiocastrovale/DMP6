# Scripts: index

Scans audio files, extracts metadata, and populates the database. Processes each artist folder completely (scan, upsert, cover art, totals) before moving to the next.

## Build

```bash
cd scripts/index && cargo build --release
```

## Usage

```bash
./index                          # Index all artists
./index /path/to/music           # Override music directory
./index --overwrite              # Nuke + re-index all
./index --from r --to s          # Index range R–S
./index --only radiohead         # Only folders starting with "radiohead"
./index --resume                 # Continue from last completed artist
./index --skip-images            # Skip cover art extraction
./index --threads 4 --limit 1000 # Limit threads and file count
```

## Per-Artist Flow

For each artist folder, the indexer completes all work before moving on:

1. **Walk** folder for audio files (mp3, flac, aac, opus, m4a, ogg)
2. **Extract** metadata in parallel (rayon + lofty)
3. **Change detection** — skip unchanged files (mtime + fileSize), hash-compare changed ones
4. **Upsert** Artist, LocalRelease, LocalReleaseTrack, TrackArtist records (batch UNNEST)
5. **Extract cover art** from first track per release (200x200 JPEG, S3 and/or local)
6. **Update totals** for this artist's releases and tracks
7. **Save progress** to `Statistics.lastIndexedArtist`

## Resume

- Progress is saved to `Statistics.lastIndexedArtist` after each artist completes
- `--resume` skips all artists alphabetically <= the saved value
- `--overwrite` clears progress before starting
- A normal run (no `--resume`) also clears any stale progress

## Artist Tag Splitting

Multi-artist tags are split into individual Artist + TrackArtist records:

- **Split on**: `/`, `//`, `\`, `\\`, `|`, `||`, `;`, `feat.`/`ft.`/`featuring`
- **Not split on**: `,` (preserves "10,000 Maniacs", "Crosby, Stills & Nash"), `&` (too ambiguous)
- "Various Artists" / "Various" / "VA" are skipped

| Tag source | Role |
|-----------|------|
| `albumArtist` main artists | `ALBUM_ARTIST` |
| `artist` main artists | `PRIMARY` |
| Featured artists (either tag) | `FEATURED` |

## Error Handling

- Per-artist error summary printed to console: `Unable to parse N files for Artist`
- Details logged to `errors.log` with `[timestamp][INDEX]` prefix
- Errors are non-fatal; indexing continues with next artist
