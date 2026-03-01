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
4. **Split artist tags** into individual artists (see below)
5. **Write** Artist, LocalRelease, LocalReleaseTrack, and TrackArtist records
   - **Note**: "Various Artists" / "Various" / "VA" are automatically skipped
6. **Extract** cover art from first track per release (200x200 JPEG)
7. **Update** release and artist totals

### Multi-artist tag splitting

Artist tags often contain multiple artists in a single string. The indexer splits these into individual Artist records and creates TrackArtist junction entries so each artist's page shows all their work.

**Delimiters split on:**
- `/` — "Artist A / Artist B"
- `;` — "Artist A; Artist B"
- `,` — only when **not** followed by a space or digit: catches `"Artist A,Artist B"` (compact tagger format) while preserving `"10,000 Maniacs"` (digit after comma) and `"Crosby, Stills & Nash"` (space after comma)
- `feat.` / `ft.` / `featuring` (case-insensitive) — extracts featured artists

**Not split on:**
- `&` — too ambiguous ("Simon & Garfunkel", "Vic Schoen & His Orchestra")
- `,` followed by a space or digit — band names and numbers

**How it maps to TrackArtist roles:**

| Tag | Split into | Role |
|-----|-----------|------|
| `albumArtist` main artists | Each gets an Artist record | `ALBUM_ARTIST` |
| `artist` main artists | Each gets an Artist record | `PRIMARY` |
| Featured artists (from either tag) | Each gets an Artist record | `FEATURED` |

The **first main album artist** (or first main track artist as fallback) becomes the canonical artist for `LocalRelease.artistId`. The web API queries through TrackArtist to show all releases/tracks where an artist appears in any role.

### Checkpoint/Resume

The indexer saves progress to the `IndexCheckpoint` table every 100 files. Use `--resume` to continue from where you left off after an interruption.

### Error Handling

- Files with missing artist tag are skipped and logged to `errors.log`
- Each track is committed individually (one failure doesn't affect others)
- Errors are non-fatal; indexing continues