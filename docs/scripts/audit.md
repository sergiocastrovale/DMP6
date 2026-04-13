# Scripts: audit

Audits the DMP database for data quality issues and exports results to an Excel workbook. Each issue type is a separate sheet with release paths split into columns for easy filtering.

## Build

```bash
cd scripts/audit && cargo build --release
```

## Usage

```bash
./audit                              # Generate reports/audit-YYYY-MM-DD.xlsx
./audit --output /path/to/report.xlsx  # Custom output path
```

## Tier 1: check we can solve automatically

Each check produces a sheet in the output workbook. Empty sheets (0 issues) are omitted.

### Duplicate Artists

Artists with the same normalized name but different IDs (case/whitespace differences).

- Query the two slugs to decide which to keep
- Update file tags (TPE2) to use the canonical spelling — get file paths from `LocalReleaseTrack.filePath` for the artist being merged
- `./sync --only="Artist Name" --overwrite`

### Orphan Artists

Artists with no linked local releases (stale DB entries from deleted/moved files).

- `python3 scripts/fix_artist_names.py --cleanup --apply` removes all orphan artists and empty releases

### Orphan Tracks

Tracks in the DB not assigned to any release.

- Resync the artist: `./sync --only="Artist Name" --overwrite`

### Empty Releases

Releases with 0 tracks linked — usually stale DB entries after files were moved or deleted.

- Resync the artist: `./sync --only="Artist Name" --overwrite`
- If the folder no longer exists, the empty release gets cleaned up

### Unsplit Multi-Artist

Releases linked to 1 artist but whose `albumArtist` tag contains separators (`/`, `;`, `\`, `feat.`, `,`).

- Query `LocalReleaseTrack.filePath` for the release to get file paths
- Fix TPE2 tags with mutagen: replace separator with `\\` (multi-value delimiter)
- `./sync --only="Artist1;Artist2" --overwrite`
- See [Post-Sync Bulk Scan Routine](../../CLAUDE.md) Phase 3–4 for the full workflow

### Incomplete Metadata

Tracks missing title, artist, or album in their file tags.

- The "Missing Fields" column shows which fields are absent
- Get file paths from `LocalReleaseTrack.filePath` and fix tags with mutagen
- Resync after fixing

## Tier 2: API-related rematching

### No MB Match

Artists with local tracks but no MusicBrainz ID.

- Search MusicBrainz manually for the artist
- If found: embed the MB artist ID in the file tags (use `LocalReleaseTrack.filePath` to locate files)
- `./sync --only="Artist Name" --overwrite`
- If not on MB: no action needed, artist stays local-only

### Artists No Art

Artists with tracks but no cover image (neither local file nor S3 URL).

- Sync fetches art from fanart.tv/MB — re-running sync may pick it up if art was added upstream
- Otherwise: place an image at `web/public/img/artists/{slug}.jpg`

### Releases No Art

Releases with no cover image (neither local nor S3).

- Place a `cover.jpg` / `cover.png` in the release folder — get the path from `LocalRelease.folderPath`
- Resync the artist to pick it up

## Tier 3: fully manual fixes (not for LLM to fix)

### Incomplete Releases

Releases with `INCOMPLETE` match status — fewer local tracks than MusicBrainz expects.

- Check the sheet to see which tracks are missing
- Either acquire the missing tracks or accept the status (no action needed if intentional)

### Extra Tracks

Releases with `EXTRA_TRACKS` status — more local tracks than the MB tracklist.

- Usually bonus tracks, deluxe editions, or wrong MB release matched
- Check if files are legit extras or duplicates/misplaced
- If mismatched MB release: fix the MB release ID in tags and resync with `--overwrite`

### Missing Releases

MB catalogue releases not found on disk. This is informational — these are releases MB knows about that you don't have.

- No action required unless you want to acquire them
- To reduce noise: these are filtered by release group type (no singles/bootlegs/demos)


## Output Format

The Excel file has one sheet per issue type. Release-based sheets split the folder path into columns:

| Artist | Path 2 | Path 3 | Path 4 | Release Title |
|--------|--------|--------|--------|---------------|
| Air | Albums | 1999 - Moon Safari | CD 2 | Moon Safari |
| Radiohead | Albums | 1997 - OK Computer | | OK Computer |

This makes it easy to filter/sort by artist, subfolder structure, or release name.

## Workflow

Run after a full or partial sync to identify issues:

```bash
./sync                    # Index + sync
./audit                   # Generate audit report
# Open reports/audit-YYYY-MM-DD.xlsx
# Fix metadata issues in files
./sync --only="artist"    # Re-sync specific artists
./audit                   # Verify fixes
```
