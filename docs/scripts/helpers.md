# Scripts: Python Helpers

Legacy Python utilities for tag fixes and DB cleanup. Most use cases are now covered by `./audit` + `./fix` — use those first. These scripts remain useful as fallbacks or for edge cases not yet handled by the Rust binaries.

All tag fixers require `mutagen`: `pip3 install --user --break-system-packages mutagen`

---

## fix_artist_names.py

Fixes corrupted TPE2 tags and compound artists, then cleans up orphaned DB data. Superceded by `./audit --corrupted/--unsplit` + `./fix --corrupted/--unsplit` for most cases, but retained for MusicBrainz-validated compound splitting.

```bash
python3 scripts/fix_artist_names.py                      # Dry run — all modes
python3 scripts/fix_artist_names.py --apply              # Apply all fixes + cleanup
python3 scripts/fix_artist_names.py --only=corrupted     # Only garbage TPE2
python3 scripts/fix_artist_names.py --only=separators    # Only compound artist splitting
python3 scripts/fix_artist_names.py --cleanup            # Only DB cleanup
python3 scripts/fix_artist_names.py --skip-mb            # Skip MusicBrainz validation
```

Correction signals for corrupted mode (priority order):
1. Majority vote — non-corrupt albumArtist from other tracks in the same release
2. Linked artists — `LocalReleaseArtist` records with ≥ 3 TrackArtist links
3. Folder consensus — most common non-corrupt albumArtist in the artist folder
4. Artist tag consensus — most common TPE1 value across the release's tracks

The `separators` mode validates each proposed artist split against MusicBrainz before applying (skips `--skip-mb` to bypass this).

---

## fix_sync_errors.py

Parses `errors.log` and fixes broken MP3 files by error category. Still the primary tool for encoding/frame corruption issues (not yet covered by `dmp-fix`).

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
./reindex-sync --only="Artist1;Artist2"
```

---

## check_ampersand_artists.py

Scans artist folders containing `&` or `/` to detect compound artists that should be split. Diagnostic only — no changes made.

```bash
python3 scripts/check_ampersand_artists.py              # Tag-based analysis
python3 scripts/check_ampersand_artists.py --mb-lookup  # + MusicBrainz API
```

Results written to `separator_analysis.log`.

---

## fix_duplicates.py

Finds duplicate artists (same normalized name, different DB records) and fixes albumArtist tags so a resync merges them. Superceded by `./audit --duplicates` + `./fix --duplicates` for most cases.

```bash
python3 scripts/fix_duplicates.py               # Dry run
python3 scripts/fix_duplicates.py --apply        # Fix tags + print resync commands
```

---

## fix_incomplete_metadata.py

Finds tracks missing title, artist, or album and derives values from folder structure and filename. Still useful for cases where `./audit --missing` finds no auto-derivable values (i.e., `proposedValues` is null).

```bash
python3 scripts/fix_incomplete_metadata.py               # Dry run
python3 scripts/fix_incomplete_metadata.py --apply        # Fix tags + print resync commands
```

---

## fix_unsplit_multiartist.py

Splits `albumArtist` tags containing separators into backslash-delimited format. Superceded by `./fix --unsplit` which now correctly distributes the compound value between TPE2 (primary only) and TPE1 (full compound).

```bash
python3 scripts/fix_unsplit_multiartist.py                # Dry run
python3 scripts/fix_unsplit_multiartist.py --apply        # Fix feat + slash + semi
python3 scripts/fix_unsplit_multiartist.py --report       # Show comma entries for manual review
```
