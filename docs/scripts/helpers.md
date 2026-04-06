# Scripts: Python Helpers

Python utilities for fixing MP3 tag issues discovered during sync. These are typically run as part of the [post-sync routine](../post_sync.md) after each batch sync.

All require `mutagen`: `pip3 install --user --break-system-packages mutagen`

---

## fix_sync_errors.py

Parses `errors.log` and fixes broken MP3 files by category.

```bash
python3 scripts/fix_sync_errors.py                        # Dry run
python3 scripts/fix_sync_errors.py --apply                # Apply all fixes
python3 scripts/fix_sync_errors.py --apply --only=encoding  # One category only
```

### Categories

| Category | Problem | Fix |
|----------|---------|-----|
| `encoding` | Invalid ID3 tag encoding | Strip + rewrite as ID3v2.4 UTF-8 (mutagen) |
| `item_size` | Invalid item size in tags | Lossless remux with ffmpeg |
| `mpeg_frame` | Corrupt MPEG frame | Lossless remux with ffmpeg |
| `ape_utf8` | APE tag UTF-8 error | Strip APE tags, keep ID3v2 |
| `missing_artist` | No TPE1 (artist) tag | Copy from TXXX:ARTISTS or TXXX:ALBUM_ARTISTS into TPE1/TPE2 |

Requires `ffmpeg` on PATH for `item_size` and `mpeg_frame` fixes.

After fixing, resync affected artists:
```bash
./sync --only="Artist1;Artist2" --overwrite
```

---

## check_ampersand_artists.py

Scans artist folders containing `&` or `/` in their name to detect compound artists that should be split into separate artists.

```bash
python3 scripts/check_ampersand_artists.py              # Tag-based analysis only
python3 scripts/check_ampersand_artists.py --mb-lookup  # Also query MusicBrainz API
```

### Signals checked

1. Multiple MusicBrainz Artist IDs in tags
2. Sort name containing `;` (multiple sort names)
3. TXXX:ARTISTS value differs from folder name
4. TPE2 (album artist) differs from folder name
5. (with `--mb-lookup`) Each split part is a real artist on MusicBrainz

### Verdicts

| Verdict | Meaning | Action |
|---------|---------|--------|
| `MULTIPLE` | Confirmed separate artists | Fix tags with mutagen |
| `LIKELY_MULTIPLE` | Probably separate, needs review | Investigate on MusicBrainz |
| `SINGLE` | Legitimate single artist name | No action |

Results written to `separator_analysis.log`.

---

## fix_compound_artists.py

Fixes MP3 tags for known compound artists by replacing ambiguous separators (`,`, `-`, `&`) with `\\` (backslash), which the sync script's `split_artists()` recognises.

```bash
python3 scripts/fix_compound_artists.py          # Dry run
python3 scripts/fix_compound_artists.py --apply  # Apply fixes
```

Contains a hardcoded `FIXES` list of album folders and their tag mappings (old value to new value). Each entry specifies which TPE2 (album artist) and TPE1 (track artist) values to replace.

Also handles edge cases like track numbers in TPE2, path fragments leaked into artist tags, and inverted "Last, First" name formats.

After fixing, resync affected artists:
```bash
./sync --only="Artist1;Artist2" --overwrite
```

Uses `MUSIC_DIR` env var (defaults to `/mnt/dmp/music/mainstream`).

---

## missing_metadata_report.py

Queries the database for tracks missing mood, BPM, or AcoustID metadata and exports an XLSX report.

```bash
python3 scripts/missing_metadata_report.py                          # Default output
python3 scripts/missing_metadata_report.py --output report.xlsx     # Custom path
```

### Output

Excel workbook with three sheets:

| Sheet | What's missing |
|-------|---------------|
| **Mood** | `MOOD_HAPPY` tag |
| **BPM** | Any BPM-related tag (`IntegerBpm`, `fBPM`, etc.) |
| **Acoustic ID** | `acoustid_id` or `ACOUSTID_FINGERPRINT` |

Each sheet lists directories containing tracks that lack the metadata.

Requires `openpyxl` and `psycopg2-binary`:
```bash
pip3 install --user --break-system-packages openpyxl psycopg2-binary
```

Reads `DATABASE_URL` from environment or `web/.env`.

---

## fix_compound_tpe2.py

Fixes compound artist TPE2 tags library-wide. Queries the DB for artists without a MusicBrainz ID whose names contain ambiguous separators (`/`, ` & `, `, `, ` w/ `), then replaces those separators with `\\` in the actual MP3 files so the sync script splits them correctly.

```bash
python3 scripts/fix_compound_tpe2.py                    # Dry run
python3 scripts/fix_compound_tpe2.py --apply             # Apply fixes
python3 scripts/fix_compound_tpe2.py --apply --resync    # Apply + print resync command
```

Handles:
- Mixed separators: "A, B & C" splits into all three artists
- Bare `/` without spaces: "Artist1/Artist2" → "Artist1\\Artist2"
- Broken tags: "lbumArtist/Bryan Ferry" → "Bryan Ferry"
- Skips known single artists with separators (AC/DC, D/A A/D)

Requires `psycopg2-binary` and `mutagen`:
```bash
pip3 install --user --break-system-packages psycopg2-binary mutagen
```

After fixing, resync affected artist folders with `--overwrite`.
