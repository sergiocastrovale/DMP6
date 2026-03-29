# Scripts: sync

Indexes local audio files and syncs artists against MusicBrainz. Processes the entire flow per artist folder: scan, extract metadata, upsert to DB, extract cover art, update totals, then MusicBrainz sync.

## Build

```bash
cd scripts/sync && cargo build --release
```

## Usage

```bash
./sync                           # Index + sync all artists
./sync /path/to/music            # Override music directory
./sync --overwrite               # Nuke + re-index + re-sync all
./sync --only="radiohead"        # Only folders matching prefix
./sync --from="A" --to="M"      # Process range
./sync --limit=10                # Limit to first N folders
./sync --resume                  # Continue from last checkpoint
./sync --skip-images             # Skip all image operations
./sync --threads 4               # Limit metadata extraction threads
./sync --verbose                 # Show skipped MB releases
```

## Per-Folder Flow

For each artist folder in MUSIC_DIR:

### Index Phase
1. **Walk** folder for audio files (mp3, flac, aac, opus, m4a, ogg)
2. **Extract** metadata in parallel (rayon + lofty)
3. **Change detection** — skip unchanged files (mtime + fileSize), hash-compare changed ones
4. **Upsert** Artist, LocalRelease, LocalReleaseTrack, TrackArtist records (batch UNNEST)
5. **Extract cover art** from first track per release (200x200 JPEG, S3 and/or local)
6. **Update totals** for this artist's releases and tracks

### MusicBrainz Sync Phase (per artist ID in folder)
7. **Skip** compound artist names (contain `/`, `;`, `\`, `|`, `feat`)
8. **Skip** if already synced (has musicbrainzId) unless `--overwrite`
9. **Search** MusicBrainz by name (with fallback strategies)
10. **Fetch** artist details: URLs, genres, tags
11. **Download** artist image (Wikipedia/Wikidata, then Fanart.tv; 200x200 JPEG)
12. **Fetch** release groups and tracks
13. **Filter** releases: skip Singles, Bootlegs, Demos, Interviews, Broadcasts
14. **Set match status** per release: `COMPLETE`, `INCOMPLETE`, `EXTRA_TRACKS`, `MISSING`
15. **Save progress** to `Statistics.lastSyncedArtist`

## Resume

- Progress saved to `Statistics.lastSyncedArtist` after each folder completes
- `--resume` skips all folders with name <= the saved value
- If stopped mid-folder, resume restarts that folder from scratch

## Artist Tag Splitting

Multi-artist tags are split into individual Artist + TrackArtist records:

- **Split on**: `/`, `//`, `\`, `\\`, `|`, `||`, `;`, `feat.`/`ft.`/`featuring`
- **Not split on**: `,` (preserves "10,000 Maniacs", "Crosby, Stills & Nash"), `&` (too ambiguous)

| Tag source | Role |
|-----------|------|
| `albumArtist` main artists | `ALBUM_ARTIST` |
| `artist` main artists | `PRIMARY` |
| Featured artists (either tag) | `FEATURED` |

## Artist Matching

- Quoted phrase search (`artist:"Name"`) with score >= 90 + Jaccard similarity >= 50%
- Single-token names require exact match
- Fallback: try raw `artist` tag, then split `albumArtist` by `, ` / ` & ` / ` vs ` / ` feat. ` / ` – `

## Rate Limiting

- Starts at 1s between requests
- Doubles delay on 503/429 (up to 10s), reduces by 15% on success (down to 1s)
- Up to 10 retries per request with exponential backoff

## Error Handling

- Errors logged to `errors.log` with `[timestamp][SYNC]` prefix
- Non-fatal; processing continues with next artist/folder
- Failed artists listed in final summary
