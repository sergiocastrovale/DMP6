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

`LocalReleaseTrack.filePath` (and `LocalRelease.folderPath`/`LocalReleaseMember.folderPath`) are stored
**relative to `MUSIC_DIR`** (e.g. `"Artist/Album/01.flac"`), so every raw path is joined onto
`MUSIC_DIR` first, then resolved through its parent directory (`delete::files::resolve_in_library` /
`canonical_parent`) and must land inside the canonical `MUSIC_DIR`; anything else - a symlinked album
folder escaping the library, a `..` segment, a stray already-absolute row pointing outside the library
- is skipped and reported, never followed. Directories emptied by the deletion are pruned upward,
stopping at `MUSIC_DIR` itself. `--dry-run` prints the counts and touches nothing. Guarded by
`scripts/delete/src/files.rs` unit tests (including the relative-path case - this used to resolve
against the process's CWD instead of `MUSIC_DIR`, silently skip every file, and leave `--files` a
no-op on real data).

**Steps 6/7 are scoped to the deletion set** (`delete::sweep::sweep_orphaned_releases`). The local sweep was
previously unscoped - it deleted *every* ownerless `LocalRelease` in the library, so deleting one artist could
garbage-collect unrelated releases that merely happened to be between owners. That is a real state during an
index run, where releases are legitimately ownerless between the folder scan and the artist-resolution pass.
Guarded by `scripts/delete/tests/delete_plan.rs`.

## After Deleting

```bash
./index --only "Name" && ./sync --only "Name"   # Re-add if needed
```

## Single release (`--release`)

```bash
./delete --release "clxxx"                # Delete one LocalRelease
./delete --release "clxxx" --dry-run      # Preview
./delete --release "clxxx" --y            # Skip confirmation
./delete --release "clxxx" --files        # Also delete the release's own folder(s) from MUSIC_DIR
```

`artist` and `--release` are mutually exclusive (clap `ArgGroup`, exactly one required). Also reachable
from the UI: artist page → release info → trash icon (ADMIN only), whose dialog exposes `--files` as an
unchecked "Remove the actual files from disk" switch. Logic lives in `delete::release` (`scripts/delete/src/release.rs`).

Removes exactly one `LocalRelease` (cascading tracks, `LocalReleaseMember` rows, `LocalReleaseArtist`,
`TrackRelatedArtist`, favorites, playlist rows, issues), leaving the rest of the owning artist's(s')
catalogue untouched. Afterwards: totals/completeness recomputed for the release's former owners, a
now-ownerless owner or a now-uncredited credit-only artist is swept via the same rule
`index::deletion::delete_orphan_artists` uses (no `LocalReleaseArtist`, `MusicBrainzReleaseArtist` or
`TrackRelatedArtist` link left), and statistics refresh.

**The matched `MusicBrainzRelease` is deleted only if nothing else still needs it** - this is the
duplicate-copy guard. A candidate (`LocalRelease.releaseId`, plus `boxReleaseId` if this was a bound box
disc) survives when any of these are still true after this release's row is gone:
- another `LocalRelease.releaseId`/`boxReleaseId` still points at it (a duplicate copy of the same
  edition - deleting one copy must never take the edition down with the other),
- a `LocalReleaseTrack.mbTrackId` elsewhere still resolves into it (a dissolved box disc's track link),
- its `status` is `MISSING` (the re-downloadable stub - retiring one is sync's job, never this).

When dropped, the next `sync` naturally re-creates the album as a `MISSING` catalogue gap. Guarded by
`scripts/delete/tests/delete_release.rs` (duplicate-copy survival, sole-copy drop, MISSING never
touched, sibling release untouched, owner-sweep vs. multi-release-owner survival).

`--files` deletes this release's own folder(s) (`LocalRelease.folderPath` plus every
`LocalReleaseMember.folderPath` - a folded box has one per disc) **whole, sidecars (cover art, `.cue`,
`.log`, `.nfo`) included** - not just the tracked audio files - but only a folder left holding no other
release's audio afterward; one still holding another release's files is kept intact. Never goes above
the release's own folder set, so the artist folder always survives. `delete::files::delete_release_folders`,
guarded by its own unit tests (exclusive folder removed whole, shared folder kept, multi-disc album
folds its own boundary, outside-MUSIC_DIR skipped, dry run touches nothing).
