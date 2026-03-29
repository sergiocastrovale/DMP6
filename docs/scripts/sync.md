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
2. **Extract** metadata in parallel (rayon + lofty), including embedded MusicBrainz IDs
3. **Change detection** — skip unchanged files (mtime + fileSize), hash-compare changed ones
4. **Split** album artist and track artist tags into individual artists (see [Artist Tag Splitting](#artist-tag-splitting))
5. **Upsert** Artist, LocalRelease (keyed by title + folderPath), LocalReleaseTrack, TrackArtist, and LocalReleaseArtist junction records (batch UNNEST)
6. **Cover art** — three-tier resolution (see [Cover Art Resolution](#cover-art-resolution))
7. **Update totals** for this artist's releases and tracks

### MusicBrainz Sync Phase (per artist ID in folder)
8. **Skip** "Various Artists"
9. **Re-match** already-synced artists without API calls (ensures correct release statuses)
10. **Search** MusicBrainz using embedded IDs first, then name-based fallback (see [Artist Matching](#artist-matching))
11. **Fetch** artist details: URLs, genres, tags
12. **Download** artist image (Wikipedia/Wikidata, then Fanart.tv; 200x200 JPEG)
13. **Fetch** release groups and tracks
14. **Filter** releases: skip Singles, Bootlegs, Demos, Interviews, Broadcasts
15. **Set match status** per release: `COMPLETE`, `INCOMPLETE`, `EXTRA_TRACKS`, `MISSING`
16. **Cover Art Archive** fallback for releases still missing art after step 6 (see [Cover Art Resolution](#cover-art-resolution))
17. **Save progress** to `Statistics.lastSyncedArtist`

## Multi-Artist Handling

Releases are keyed by `(title, folderPath)` — not tied to a single artist. A release can belong to multiple artists via the `LocalReleaseArtist` junction table. This means:

- **No compound artists**: "Abc, XY & Z" is never stored as one artist. Instead, three separate Artist records are created (Abc, XY, Z) and all three are linked to the same release.
- **Shared releases**: If you browse artist "Abc", you see the collaboration release. If you browse "XY", you see the same release (not a copy).
- **Split happens at index time**: Album artist and track artist tags are split by separators before any DB writes.

## Artist Tag Splitting

Multi-artist tags are split into individual Artist + TrackArtist records:

- **Split on**: `/`, `//`, `\`, `\\`, `,`, `;`, `|`, `||`, `feat.`/`ft.`/`featuring` (with and without trailing space)
- **Not split on**: `&` (too ambiguous — "Simon & Garfunkel", "Crosby, Stills & Nash")

| Tag source | Role |
|-----------|------|
| `albumArtist` main artists | `ALBUM_ARTIST` |
| `artist` main artists | `PRIMARY` |
| Featured artists (either tag) | `FEATURED` |

## Artist Matching

Five-step resolution with embedded MusicBrainz IDs taking priority:

1. **Embedded album artist ID** (`MUSICBRAINZ_ALBUMARTISTID`) — direct artist lookup via `/artist/{id}`. This is the source of truth when available.
2. **Embedded album ID** (`MUSICBRAINZ_ALBUMID`) — look up the release group via `/release-group/{id}?inc=artist-credits` to get all artist credits. Returns primary match + additional artists discovered from credits.
3. **Name search** (stored artist name) — quoted phrase search (`artist:"Name"`) with score >= 90 + Jaccard similarity >= 50%. Single-token names require exact match.
4. **Raw artist tag** — if the raw `artist` tag from a sample track differs from the stored name, search that too. Saved as a candidate but does not short-circuit — continues to step 5.
5. **Split albumArtist** — split by `, `, ` & `, ` vs `, ` vs. `, ` feat `, ` feat. `, ` – ` and search each part. All matches are collected and synced.

Steps 1-2 avoid name-based searching entirely when embedded MusicBrainz metadata is present in the audio files.

## Cover Art Resolution

Three-tier fallback for release cover art:

1. **Embedded metadata** — extract cover from the first audio file in the release that has embedded artwork (via lofty). Resized to 200x200 JPEG.
2. **Folder images** — if no embedded art, check the release folder for `cover.jpg` or `folder.jpg`. Resized to 200x200 JPEG.
3. **Cover Art Archive** — after the MB sync phase links releases to release groups, fetch from `coverartarchive.org/release-group/{id}/front`. The downloaded image is also saved as `folder.jpg` in the source folder (so future syncs use tier 2 instead of hitting the API again).

All tiers support both local storage (`web/public/img/releases/`) and S3 upload, controlled by the `IMAGE_STORAGE` env var.

## Resume

- Progress saved to `Statistics.lastSyncedArtist` after each folder completes
- `--resume` skips all folders with name <= the saved value
- If stopped mid-folder, resume restarts that folder from scratch

## Rate Limiting

- Starts at 1s between requests
- Doubles delay on 503/429 (up to 10s), reduces by 15% on success (down to 1s)
- Up to 10 retries per request with exponential backoff

## Error Handling

- Errors logged to `errors.log` with `[timestamp][SYNC]` prefix
- Non-fatal; processing continues with next artist/folder
- Failed artists listed in final summary
