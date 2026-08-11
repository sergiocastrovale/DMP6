# Scripts: delete

Permanently deletes an artist's catalogue (local + MB), images, and any co-artists whose entire catalogue falls within the deletion set. If the artist is credited (`TrackRelatedArtist`) on other artists' tracks outside the deletion set, those credits are removed too - warned about in the plan display before confirming.

## Usage

```bash
./delete "Radiohead"                # Delete single artist
./delete "Artist A;Artist B"        # Delete multiple (semicolon-separated)
./delete "Radiohead" --dry-run      # Preview without changes
./delete "Radiohead" --y            # Skip confirmation
./delete "Radiohead" --files        # Also delete the audio files from MUSIC_DIR
```

Also reachable from the UI: artist page → **Remove** (ADMIN only), whose dialog exposes `--files` as an
unchecked "Remove all files from this artist" switch.

## CLI Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `artist` | String (positional) | required | Artist name(s), semicolon-separated |
| `--y` | bool | false | Skip confirmation prompt |
| `--files` | bool | false | Delete the artist's audio files and the folders they empty |
| `--dry-run` | bool | false | Preview without changes |

Artist lookup uses **case-insensitive exact match** (SQL `LOWER(name) = LOWER($1)`). Exits if 0 or >1 matches per name.

## Cascade Rule

Co-artists are automatically included when ALL of their local releases AND MB releases fall within the deletion set.

## What Gets Deleted

Within a single **transaction** (7 steps, plus a non-critical cleanup step after commit):
1. `_ArtistGenres` junction rows
2. `_ReleaseGenres` junction rows
3. `LocalRelease` rows (cascades to tracks, playlist/favorite rows, release-artist links, `TrackRelatedArtist`)
4. `MusicBrainzRelease` rows (cascades to tracks, release-artist links, favorites)
5. `Artist` rows (cascades to remaining `ArtistUrl`, `MusicBrainzReleaseArtist`, and any `TrackRelatedArtist` credit this artist held on OTHER artists' tracks - those credits are lost)
6. Sweep orphaned `LocalRelease` rows
7. Sweep orphaned `MusicBrainzRelease` rows
8. `FolderScan` cleanup (outside the transaction)

Also: release + artist images (local + S3), statistics refresh.

## `--files`

Runs **after** the transaction commits, so a failed delete never leaves the catalogue intact with the
files gone. Track paths are read before the transaction (once the rows are deleted there is nothing
left to name the files).

Every path is resolved through its parent directory (`delete::files::canonical_parent`) and must land
inside the canonical `MUSIC_DIR`; anything else - a symlinked album folder escaping the library, a
stale absolute path from a moved library, a `..` segment - is skipped and reported, never followed.
Directories emptied by the deletion are pruned upward, stopping at `MUSIC_DIR` itself. `--dry-run`
prints the counts and touches nothing. Guarded by `scripts/delete/src/files.rs` unit tests.

**Steps 6/7 are scoped to the deletion set** (`delete::sweep::sweep_orphaned_releases`). The local sweep was
previously unscoped - it deleted *every* ownerless `LocalRelease` in the library, so deleting one artist could
garbage-collect unrelated releases that merely happened to be between owners. That is a real state during an
index run, where releases are legitimately ownerless between the folder scan and the artist-resolution pass.
Guarded by `scripts/delete/tests/delete_plan.rs`.

## After Deleting

```bash
./index --only "Name" && ./sync --only "Name"   # Re-add if needed
```
