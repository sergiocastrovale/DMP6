# Scripts: index

Walks MUSIC_DIR, extracts metadata from audio files, and upserts the local DB tree. Sets `lastIndexedAt` on each processed artist, which triggers `sync` to re-sync on the next run.

## Build

```bash
cd scripts && cargo build --release -p index
```

## Usage

```bash
./index                          # Index all artists
./index --only="radiohead"       # Only folders matching prefix
./index --only="radiohead;bjork" # Multiple artists
./index --from="A" --to="M"      # Letter range
./index --overwrite              # Force re-index (ignore change detection)
./index --quick                  # Skip unchanged folders (mtime check)
./index --resume                 # Continue from last checkpoint
./index --skip-covers            # Skip cover art extraction
./index --threads 4              # Rayon thread count (default 8)
./index --web                    # Emit PROGRESS:{json} for the web terminal
```

## Output modes

Without `--web`, the script prints colored, indented progress (folder headers, `→` steps, `✓` success marks). With `--web`, it emits `PROGRESS:{json}` lines consumed by the web UI progress bar, plus plain text for the terminal panel. The web UI appends `--web` automatically when invoking scripts.

## Per-Folder Flow

1. **Walk** folder for audio files (mp3, flac, aac, opus, m4a, ogg)
2. **Extract** metadata in parallel (rayon + lofty), including embedded MusicBrainz IDs
3. **Change detection** — skip unchanged files (mtime + fileSize), hash-compare changed ones
4. **Split** album artist and track artist tags into individual artists
5. **Upsert** Artist, LocalRelease, LocalReleaseTrack, TrackArtist, LocalReleaseArtist (batch UNNEST)
6. **Cover art** — extract from embedded tags or folder.jpg, upload to S3 if configured
7. **Update totals** for this artist's releases and tracks
8. **Set `lastIndexedAt`** on Artist
9. **Upsert FolderScan** — stores folder mtime for `--quick` mode

## Release Grouping

Releases are deduplicated by `groupKey`:
- With MB album ID: `"mb:{mbAlbumId}"`
- Without: `"meta:{slugTitle}:{year}:{slugArtist}"`

## Artist Tag Splitting

`split_artists()` in `common/src/artists.rs`:
- Splits on `feat.`/`ft.`/`featuring` → featured artists
- Splits on `//` `\\` `||` `;` `|` — unambiguous separators
- Splits on ` / ` ` \ ` (space-surrounded only — preserves AC/DC)
- Splits on `vs.`/`vs`
- Does **not** split on `,` (preserves "10,000 Maniacs")
- Does **not** split on `&` (preserves "Simon & Garfunkel")

## Running on NAS

```bash
docker exec dmp index --from=e --to=fz
```
