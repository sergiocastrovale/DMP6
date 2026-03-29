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

## Checks

Each check produces a sheet in the output workbook. Empty sheets (0 issues) are omitted.

| Sheet | What it finds |
|-------|---------------|
| **Duplicate Artists** | Artists with the same normalized name (case/whitespace differences) |
| **Orphan Artists** | Artists with no linked releases (stale data) |
| **No MB Match** | Artists with tracks but no MusicBrainz ID |
| **Artists No Art** | Artists with tracks but no cover image |
| **Empty Releases** | Releases with 0 tracks linked |
| **Releases No Art** | Releases with no cover image (neither local nor S3) |
| **Incomplete Releases** | Releases with `INCOMPLETE` status (some MB tracks missing locally) |
| **Extra Tracks** | Releases with `EXTRA_TRACKS` status (more local tracks than MB expects) |
| **Missing Releases** | MB releases not found on disk (`MISSING` status) |
| **Orphan Tracks** | Tracks not assigned to any release |
| **Unsplit Multi-Artist** | Releases linked to 1 artist but containing separator characters in `albumArtist` tag (possibly missed split) |
| **Incomplete Metadata** | Tracks missing title, artist, or album metadata |

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
