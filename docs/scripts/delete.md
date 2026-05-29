# Scripts: delete

Permanently deletes an artist's catalogue (local + MB), images, and any co-artists whose entire catalogue falls within the deletion set. Smarter than `nuke --only` - artists featured on other artists' tracks are **flipped to `relatedOnly`** instead of deleted.

## Usage

```bash
./delete "Radiohead"                # Delete single artist
./delete "Artist A;Artist B"        # Delete multiple (semicolon-separated)
./delete "Radiohead" --dry-run      # Preview without changes
./delete "Radiohead" --y            # Skip confirmation
```

## CLI Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `artist` | String (positional) | required | Artist name(s), semicolon-separated |
| `--y` | bool | false | Skip confirmation prompt |
| `--dry-run` | bool | false | Preview without changes |

Artist lookup uses **case-insensitive exact match** (SQL `LOWER(name) = LOWER($1)`). Exits if 0 or >1 matches per name.

## Artist Fate

Each artist gets one of two outcomes:

- **FullDelete** - no surviving track credits outside the deletion set. Artist row deleted entirely.
- **FlipRelatedOnly** - artist appears as `TrackRelatedArtist` on tracks by other artists outside the deletion set. Flipped to `relatedOnly = true`, all stats/MB data/images cleared, but the artist row survives so existing track credits remain valid.

This is the key difference from `nuke --only`, which always fully deletes.

## Cascade Rule

Co-artists are automatically included when ALL of their local releases AND MB releases fall within the deletion set. Each cascaded co-artist also gets a FullDelete or FlipRelatedOnly fate check.

## What Gets Deleted

Within a single **transaction** (10 steps):
1. `_ArtistGenres` junction rows
2. `_ReleaseGenres` junction rows
3. `ArtistUrl` rows for flipped artists
4. `MusicBrainzReleaseArtist` links for flipped artists
5. `LocalRelease` rows (cascades to tracks, playlist/favorite rows, release-artist links)
6. `MusicBrainzRelease` rows (cascades to tracks, release-artist links, favorites)
7. Flip artists to `relatedOnly = true` (clear image, MB ID, stats)
8. Delete fully-removed `Artist` rows
9. Sweep orphaned `LocalRelease` rows
10. Sweep orphaned `MusicBrainzRelease` rows

Also: release + artist images (local + S3), `FolderScan` entries (outside transaction), statistics refresh.

## After Deleting

```bash
./index --only "Name" && ./sync --only "Name"   # Re-add if needed
```
