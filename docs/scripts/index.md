# Scripts: index

Scans audio files, extracts metadata, and populates the database.

## Build

Scripts auto-build on first run. To build manually:

```bash
cd scripts/index && cargo build --release
```

### Usage

```bash
# Basic usage (reads MUSIC_DIR from .env)
./index

# Override music directory
./index /path/to/music

# Full re-index (deletes existing data first)
./index --overwrite

# Scan specific range
./index --from r --to s

# Only scan folders starting with "radiohead"
./index --only radiohead

# Resume interrupted scan
./index --resume

# Skip cover art extraction
./index --skip-images

# Limit threads and file count
./index --threads 4 --limit 1000
```

### How it works

1. **Walk** the music directory for audio files (mp3, flac, aac, opus, m4a, ogg)
2. **Extract** metadata using `lofty` crate (fast, Rust-native)
3. **Change detection**:
   - If `mtime + fileSize` match existing record: skip entirely
   - If changed, compute `contentHash` (MD5 of key fields). If hash matches: update mtime only
   - If hash differs: full metadata update
4. **Write** Artist, LocalRelease, LocalReleaseTrack, and TrackArtist records
   - **Note**: "Various Artists" is automatically skipped (compilation marker, not a real artist)
5. **Extract** cover art from first track per release (200x200 JPEG)
6. **Update** release and artist totals

### Checkpoint/Resume

The indexer saves progress to the `IndexCheckpoint` table every 100 files. Use `--resume` to continue from where you left off after an interruption.

### Error Handling

- Files with missing artist tag are skipped and logged to `errors.log`
- Each track is committed individually (one failure doesn't affect others)
- Errors are non-fatal; indexing continues