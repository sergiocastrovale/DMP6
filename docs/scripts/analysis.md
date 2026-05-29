# Scripts: analysis

Standalone file scanner - reads audio files directly (no DB), detects metadata gaps, generates a multi-page HTML report. Optionally quarantines bad files or auto-fixes with beets.

## Usage

```bash
./analysis /mnt/music                      # Scan all, generate report
./analysis /mnt/music --from=a --to=m      # Letter range
./analysis /mnt/music --only="radiohead"   # Single artist
./analysis /mnt/music --limit 500          # First 500 files only
./analysis /mnt/music --only-critical      # Only critical page
./analysis /mnt/music --only-mb --only-ids # Combine page filters
./analysis /mnt/music --no-report          # Scan only, skip report
./analysis /mnt/music --quarantine         # Move bad files to staging
./analysis /mnt/music --quarantine-dry     # Preview quarantine moves
./analysis /mnt/music --end-quarantine     # Restore quarantined files
./analysis /mnt/music --autofix            # Auto-tag with beets
./analysis /mnt/music --autofix-dry        # Preview beets changes
./analysis /mnt/music --output-dir ./out   # Custom report output directory (default: ../../reports)
./analysis /mnt/music --unc-prefix "\\\\nas" # Windows UNC prefix for file links in report
```

## CLI Flags

| Flag | Type | Default | Description |
|---|---|---|---|
| `scan_path` | String (positional) | required | Root directory to scan |
| `--from` | String | - | Only folders from this prefix |
| `--to` | String | - | Only folders up to this prefix |
| `--only` | String | - | Only folders starting with this prefix |
| `--limit` | usize | 0 (all) | Stop after N audio files |
| `--output-dir` | String | `../../reports` | Report output directory |
| `--unc-prefix` | String | - | Windows UNC prefix for file links |
| `--no-report` | bool | false | Scan only, skip HTML report |
| `--only-critical` | bool | false | Only generate critical + index pages |
| `--only-mb` | bool | false | Only generate MB + index pages |
| `--only-discogs` | bool | false | Only generate Discogs + index pages |
| `--only-issues` | bool | false | Only generate issues + index pages |
| `--only-ids` | bool | false | Only generate IDs + index pages |
| `--only-other` | bool | false | Only generate other + index pages |
| `--quarantine` | bool | false | Move problem files to staging folders |
| `--quarantine-dry` | bool | false | Preview quarantine moves |
| `--end-quarantine` | bool | false | Reverse quarantine (restore files) |
| `--autofix` | bool | false | Auto-tag with beets |
| `--autofix-dry` | bool | false | Preview beets changes |

Page filters (`--only-*`) can be combined.

## Report Output

```
reports/analysis_YYYYMMDD_HHMMSS/
├── css/styles.css
├── js/report.js
├── index.html              ← dashboard
└── pages/
    ├── issues.html         ← lone files + unreadable
    ├── critical_N.html     ← missing artist/title/year
    ├── mb_N.html           ← MusicBrainz IDs
    ├── discogs_N.html      ← Discogs IDs
    ├── ids_N.html          ← AcoustID, SongKong, Bandcamp, Wikipedia
    └── other_N.html        ← Genre, BPM, Mood, Album Art
```

Pages split into 20-artist chunks with pagination. `index.html` and `issues.html` always generated.

## Phases

1. **Walk** - collect audio files (mp3/flac/m4a/opus/aac/ogg), count per folder
2. **Scan** - parallel metadata extraction via rayon + lofty
3. **Filter** - keep files with at least one issue
4. **Auto-fix** (optional) - `beet import -C -w -q` per album directory, temp library
5. **Quarantine** (optional) - move files to `__QUARANTINE`, `__NEEDS_REVIEW`, `__UNREADABLE`, `__AUTOFIXED`
6. **Report** - generate HTML pages with search, sort, subtabs

## What Gets Checked

| Page | Fields |
|------|--------|
| Critical | Artist, Title, Year (missing/blank/invalid) |
| MB | MB Artist ID, MB Track ID, MB Album ID |
| Discogs | Discogs Artist URL, Discogs Release URL |
| IDs | AcoustID, SongKong, Bandcamp, Wikipedia |
| Other | Genre, BPM, Mood tags, Album Art |

## Quarantine

- `__QUARANTINE` - files with issues (multi-file folders)
- `__NEEDS_REVIEW` - files with issues (lone file in folder)
- `__UNREADABLE` - files that couldn't be parsed
- `__AUTOFIXED` - files fixed by beets (when `--autofix --quarantine`)

`--end-quarantine` reverses all moves.

## Beets Auto-fix

Requires `beet` + `fpcalc` installed. Uses temp library (`/tmp/analysis_autofix_<pid>.db`).

- Albums: `beet import -C -w -q <dir>`
- Singletons: `beet import -s -C -w -q <dir>`
- Quiet mode = skips uncertain matches, no bad data written
- Report shows inline: `✓` matched, `⚠` skipped

## Build

```bash
cd scripts/analysis && cargo build --release
```
