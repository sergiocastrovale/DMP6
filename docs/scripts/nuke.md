# Scripts: nuke

Truncates all database tables and deletes all image files. **Destructive** — requires typing `y` to confirm.

## Usage

```bash
./nuke                          # Wipe everything (DB + images)
./nuke --keep-artist-img        # Wipe everything, preserve artist images
./nuke --y                      # Skip confirmation prompt
./nuke --only="Artist Name"     # Delete one artist (and cascade ghost co-artists)
./nuke --only="A;B"             # Delete multiple artists by prefix
./nuke --only="Name" --dry-run  # Preview what would be deleted
```

## Full wipe

Truncates all tables (cascading) and deletes every image file under `web/public/img/releases/` and `web/public/img/artists/` (plus S3 if `IMAGE_STORAGE=s3` or `both`).

## `--only`

Selectively deletes one or more artists and their entire catalogue. Uses the same prefix filter as `./index --only` and `./sync --only` — semicolon-separated, case-insensitive.

**What gets deleted:**

- The `Artist` row (cascades to `ArtistUrl`, junction tables, `TrackArtist`)
- Their `_ArtistGenres` M:N rows
- All `LocalRelease` rows for the artist (cascades to `LocalReleaseTrack`, `FavoriteTrack`, `PlaylistTrack`, `LocalReleaseArtist`)
- All `MusicBrainzRelease` rows (cascades to `MusicBrainzReleaseTrack`, `MusicBrainzReleaseArtist`, `FavoriteRelease`)
- Release cover images (local + S3)
- Artist images (local + S3) — unless `--keep-artist-img`
- `FolderScan` cache entries for deleted folder paths
- Two orphan sweeps remove any `LocalRelease`/`MusicBrainzRelease` that lost their last artist link

**Cascade rule:** A co-artist `Y` is deleted if and only if:
1. All `LocalReleaseArtist` rows for `Y` point into the deletion set
2. All `MusicBrainzReleaseArtist` rows for `Y` point into the deletion set
3. No `TrackArtist` rows for `Y` link to tracks in releases outside the deletion set

This catches featured/split artists who have no independent catalogue beyond the shared releases. An artist with even one unrelated release is left untouched.

The full plan (targets + cascaded artists, release counts) is always printed before confirmation.

## `--keep-artist-img`

Skips deletion of `web/public/img/artists/` and the S3 `artists/` prefix. Works in both full-wipe and `--only` modes.

## After nuking

```bash
./index && ./sync    # Full rebuild from scratch
# or for --only:
./index --only="Name" && ./sync --only="Name"   # Re-index + re-sync specific artist
```
