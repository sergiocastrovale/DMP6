# Scripts: nuke

Truncates all database tables and deletes all image files. **Destructive** - requires typing `y` to confirm.

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
| `--only` | String | - | Delete only matching artist(s), semicolon-separated, **always exact match** |
| `--dry-run` | bool | false | Preview without making any changes |

## Full Wipe

One atomic `TRUNCATE ... CASCADE` over 24 tables (catalogue, playlists, favorites, `FolderScan`, `FixHistory`, `MbArtistLookup`) and deletes every `.jpg` under `web/public/img/releases/` and `web/public/img/artists/` (plus S3 if `IMAGE_STORAGE=s3` or `both`). If the truncate fails nothing is deleted - images included. The printed database URL has its credentials removed. Issue tables aren't listed explicitly — they go via the `Artist`/release cascades.

`Settings`, `User` and `RolePermission` are **not** truncated: config and logins survive a full nuke. `Statistics` is truncated, which includes the scan-lock row; the next `acquire_lock` recreates it.

## `--only` (Selective Delete)

Resolves the matching artists (**exact match**, `;`-separated - "Air" won't catch "Airbag") plus their
connected duplicates, then runs exactly the same plan and deletion as `./delete` (`delete::artist`):
releases only they own are deleted, releases another surviving artist also owns are kept and only
unlinked, credit-only survivors are kept, MusicBrainz releases and covers go only when nothing else uses
them. See [delete.md](delete.md). The plan is printed before confirmation.

## `--keep-artist-img`

Skips deletion of artist images. Works in both full-wipe and `--only` modes.

## After Nuking

```bash
./index && ./sync    # Full rebuild from scratch
# or for --only:
./index --only "Name" && ./sync --only "Name"
```
