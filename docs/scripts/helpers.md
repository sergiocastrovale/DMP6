# Scripts: Python Helpers

Python utilities for database cleanup and MP3 tag fixes. Typically run as part of the [post-sync routine](../post_sync.md) after each batch sync.

All tag fixers require `mutagen`: `pip3 install --user --break-system-packages mutagen`

---

## fix_artist_names.py

Unified script that fixes artist name issues and cleans up orphaned DB data.

```bash
python3 scripts/fix_artist_names.py                      # Dry run — all modes
python3 scripts/fix_artist_names.py --apply              # Apply all fixes + cleanup
python3 scripts/fix_artist_names.py --only=corrupted     # Only garbage in TPE2
python3 scripts/fix_artist_names.py --only=separators    # Only compound artist splitting
python3 scripts/fix_artist_names.py --cleanup            # Only DB cleanup
python3 scripts/fix_artist_names.py --skip-mb            # Skip MusicBrainz validation
```

### Mode: corrupted

Finds tracks with corrupted albumArtist (TPE2) tags and derives corrections from DB signals.

| Pattern | Example | Cause |
|---------|---------|-------|
| Purely numeric | `002`, `101` | Track number in TPE2 |
| Track-number prefix | `05 - Regurgitate` | Track num + artist concatenated |
| Year as albumArtist | `1996` | Year field leaked into TPE2 |
| Full path string | `1966 - Artist - Album @320` | Filename/folder info in TPE2 |

Correction signals (priority order):
1. Majority vote — non-corrupt albumArtist from other tracks in the same release
2. Linked artists — `LocalReleaseArtist` records with ≥ 3 TrackArtist links
3. Folder consensus — most common non-corrupt albumArtist in the artist folder
4. Artist tag consensus — most common TPE1 value across the release's tracks

### Mode: separators

Finds artists with `&`, `/`, or `feat.` in their name and determines whether they are compound or single artists. Uses MusicBrainz validation per artist (full name check + parts check).

### Mode: cleanup

Removes orphaned DB data after tag fixes and resyncs.

| Category | What it deletes |
|----------|-----------------|
| Phantom artists | Stale TrackArtist + LocalReleaseArtist links |
| Orphan artists | Artists with zero local release tracks + images |
| Orphan MB releases | `MusicBrainzRelease` with no artist links |
| Empty releases | `LocalRelease` with zero tracks |

Requires `boto3` for S3 image deletion (gracefully skipped if missing).

---

## fix_sync_errors.py

Parses `errors.log` and fixes broken MP3 files by category.

```bash
python3 scripts/fix_sync_errors.py                        # Dry run
python3 scripts/fix_sync_errors.py --apply                # Apply all fixes
python3 scripts/fix_sync_errors.py --apply --only=encoding  # One category
```

| Category | Problem | Fix |
|----------|---------|-----|
| `encoding` | Invalid ID3 tag encoding | Strip + rewrite as ID3v2.4 UTF-8 |
| `item_size` | Invalid item size in tags | Lossless remux with ffmpeg |
| `mpeg_frame` | Corrupt MPEG frame | Lossless remux with ffmpeg |
| `ape_utf8` | APE tag UTF-8 error | Strip APE tags, keep ID3v2 |
| `missing_artist` | No TPE1 tag | Copy from TXXX:ARTISTS into TPE1/TPE2 |

After fixing, re-index and re-sync affected artists:
```bash
./index --only="Artist1;Artist2" --overwrite && ./sync --only="Artist1;Artist2" --overwrite
```

---

## check_ampersand_artists.py

Scans artist folders containing `&` or `/` to detect compound artists that should be split.

```bash
python3 scripts/check_ampersand_artists.py              # Tag-based analysis
python3 scripts/check_ampersand_artists.py --mb-lookup  # + MusicBrainz API
```

Results written to `separator_analysis.log`.

---

## missing_metadata_report.py

Queries the DB for tracks missing mood, BPM, or AcoustID metadata and exports an XLSX report.

```bash
python3 scripts/missing_metadata_report.py
python3 scripts/missing_metadata_report.py --output report.xlsx
```

Requires `openpyxl` and `psycopg2-binary`.

---

## fix_duplicates.py

Finds duplicate artists (same normalized name, different DB records) and fixes albumArtist tags on the smaller set so a resync merges them.

```bash
python3 scripts/fix_duplicates.py               # Dry run
python3 scripts/fix_duplicates.py --apply        # Fix tags + print resync commands
```

---

## fix_incomplete_metadata.py

Finds tracks missing title, artist, or album and derives values from folder structure and filename.

```bash
python3 scripts/fix_incomplete_metadata.py               # Dry run
python3 scripts/fix_incomplete_metadata.py --apply        # Fix tags + print resync commands
```

---

## fix_unsplit_multiartist.py

Finds releases whose albumArtist tag contains separators and rewrites them as backslash-delimited multi-value tags.

```bash
python3 scripts/fix_unsplit_multiartist.py                # Dry run
python3 scripts/fix_unsplit_multiartist.py --apply        # Fix feat + slash + semi
python3 scripts/fix_unsplit_multiartist.py --report       # Show comma entries for manual review
```
