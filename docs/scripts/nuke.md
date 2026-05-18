# Scripts: nuke

Truncates all database tables and deletes all image files. **Destructive** — requires typing `y` to confirm.

## Usage

```bash
./nuke                          # Wipe everything (DB + images)
./nuke --keep-artist-img        # Wipe everything, preserve artist images
./nuke --y                      # Skip confirmation prompt
./nuke --only "Artist Name"     # Delete one artist (always exact match)
./nuke --only "A;B"             # Delete multiple artists (semicolon-separated, exact)
./nuke --only "Name" --dry-run  # Preview what would be deleted
```

## CLI Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `--y` | bool | false | Skip confirmation prompt |
| `--keep-artist-img` | bool | false | Preserve artist images (local + S3) |
| `--only` | String | — | Delete only matching artist(s), semicolon-separated, **always exact match** |
| `--dry-run` | bool | false | Preview without making any changes |

## Full Wipe

Truncates all tables (cascading, 21 tables) and deletes every `.jpg` under `web/public/img/releases/` and `web/public/img/artists/` (plus S3 if `IMAGE_STORAGE=s3` or `both`).

## `--only` (Selective Delete)

Deletes matching artists and their entire catalogue. Uses **exact match** (no prefix matching) — "Air" won't catch "Airbag".

**What gets deleted:**

- `Artist` row (cascades to `ArtistUrl`, junction tables)
- `_ArtistGenres` and `_ReleaseGenres` M:N rows
- All `LocalRelease` rows (cascades to tracks, favorites, playlists, release-artist links)
- All `MusicBrainzRelease` rows (cascades to tracks, release-artist links, favorites)
- Release + artist images (local + S3)
- `FolderScan` cache entries for deleted folder paths
- Orphan sweeps remove any `LocalRelease`/`MusicBrainzRelease` that lost their last artist link

Executes within a **transaction**.

**Cascade rule:** Co-artist `Y` is also deleted if:
1. All `LocalReleaseArtist` rows for `Y` point into the deletion set
2. All `MusicBrainzReleaseArtist` rows for `Y` point into the deletion set
3. `Y` has no `TrackRelatedArtist` rows pointing to tracks outside the deletion set

Full plan (targets + cascaded artists, counts) is printed before confirmation.

## `--keep-artist-img`

Skips deletion of artist images. Works in both full-wipe and `--only` modes.

## After Nuking

```bash
./index && ./sync    # Full rebuild from scratch
# or for --only:
./index --only "Name" && ./sync --only "Name"
```
