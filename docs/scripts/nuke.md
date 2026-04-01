# Scripts: nuke

Wipes database tables and image files. **Destructive** — requires typing `y` to confirm.

## Usage

```bash
./nuke                 # Wipe everything (DB + images)
./nuke --local-only    # Wipe only local file-derived data, preserve MB catalogue
./nuke --y             # Skip confirmation prompt
./nuke --local-only --y
```

## Modes

### Full nuke (default)

Truncates all tables and deletes all image files:

1. Truncates all database tables (cascading)
2. Deletes local image files (`web/public/img/`)
3. Deletes S3 images (if `IMAGE_STORAGE=s3` or `both`)

### `--local-only`

Deletes only the local file-derived side of the database. The MusicBrainz catalogue, artist metadata, and images are fully preserved.

**Deleted:**
- `LocalRelease`, `LocalReleaseTrack`, `LocalReleaseArtist`
- `TrackArtist`, `FavoriteTrack`, `PlaylistTrack`

**Preserved:**
- `Artist` (including `musicbrainzId`, images, slugs)
- `MusicBrainzRelease`, `MusicBrainzReleaseTrack`, `MusicBrainzReleaseArtist`
- `ArtistUrl`, `_ArtistGenres`, `_ReleaseGenres`, `Genre`, `ReleaseType`
- `FavoriteRelease`, `Playlist`, `Settings`, `Statistics`

**What's lost:** play counts, playlist track contents, favorite tracks.

**When to use:** when re-indexing to fix a local data issue without wanting to re-query MusicBrainz. After `./nuke --local-only`, run `./sync` — artists with an existing `musicbrainzId` bypass the MB API entirely and re-match from the local DB cache.
