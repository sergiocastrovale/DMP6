# Scripts: Python Helpers

Python utilities for database cleanup and MP3 tag fixes. Typically run as part of the [post-sync routine](../post_sync.md) after each batch sync, or standalone via the [audit report](audit.md).

All tag fixers require `mutagen`: `pip3 install --user --break-system-packages mutagen`

---

## fix_artist_names.py

Unified script that fixes artist name issues and cleans up orphaned DB data. Three modes run by default, or individually with `--only`/`--cleanup`.

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
| Full path string | `1966 - Artist - Album - 1966 @320` | Filename/folder info in TPE2 |
| Bitrate marker | `Artist Name @320` | Bitrate info in TPE2 |

Correction signals (priority order):
1. **Majority vote** — non-corrupt albumArtist from other tracks in the same release
2. **Linked artists** — `LocalReleaseArtist` records with >= 3 TrackArtist links, joined with `\`
3. **Folder consensus** — most common non-corrupt albumArtist in the artist folder (prefers folder name match)
4. **Artist tag consensus** — most common TPE1 (artist) value across the release's tracks

Pre-checks numeric albumArtist values against MusicBrainz before attempting correction (catches legitimate numeric-name artists like band "3", "2002").

### Mode: separators

Finds artists with `&`, `/`, or `feat.` in their name and determines whether they are compound (multiple artists) or single artists.

Two-phase MusicBrainz validation per artist:
1. **Full name check** — if the full compound name is a confirmed MB artist (e.g. "AC/DC", "Kool & The Gang"), skip
2. **Parts check** — split by separator, check each part. If >50% are confirmed MB artists, mark for splitting

Maintains a `KNOWN_SINGLE_ARTISTS` pre-filter (~40 entries) for fast skipping before MB API calls. Handles both bare (`/`, `&`) and spaced (` / `, ` & `) separators.

### Mode: cleanup

Removes orphaned DB data after tag fixes and resyncs.

| Category | What it finds | What it deletes |
|----------|--------------|-----------------|
| Phantom artists | Numeric-named artists with stale TrackArtist links (tracks now have correct albumArtist) | TrackArtist + LocalReleaseArtist links (artist then removed as orphan) |
| Orphan artists | Artists with zero local release tracks | Artist + all related data (URLs, genres, MB links) + images (S3 + local) |
| Orphan MB releases | `MusicBrainzRelease` records with no artist links | MB release + its tracks |
| Empty releases | `LocalRelease` records with zero tracks | Release + artist links |

Also updates `Statistics.artists` count.

Requires `boto3` for S3 image deletion (gracefully skipped if not installed): `pip3 install --user --break-system-packages boto3`

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

## fix_duplicates.py

Finds duplicate artists (same normalized name, different DB records) and fixes album-artist tags on the smaller set so that a resync merges them into one. Pairs where both artists have different MusicBrainz IDs are skipped (confirmed different artists).

```bash
python3 scripts/fix_duplicates.py               # Dry run — list pairs and file counts
python3 scripts/fix_duplicates.py --apply        # Fix tags + print resync commands
```

The canonical name is the one with more tracks (minimises file changes). The script updates the TPE2/albumArtist tag on all files belonging to the smaller artist, then prints `./sync --only="..." --overwrite` commands to merge them in the DB.

---

## fix_incomplete_metadata.py

Finds tracks missing title, artist, or album tags and derives values from the folder structure and filename.

```bash
python3 scripts/fix_incomplete_metadata.py               # Dry run — show samples
python3 scripts/fix_incomplete_metadata.py --apply        # Fix tags + print resync commands
```

Derivation rules:
- **Album**: from parent folder name, strip `YEAR - ` prefix (e.g. `1989 - Bird-Period` -> `Bird-Period`)
- **Title**: from filename, strip track number prefix (e.g. `02 When Is a Man.mp3` -> `When Is a Man`)
- **Year**: from parent folder name (e.g. `1989`)

---

## fix_unsplit_multiartist.py

Finds releases linked to a single artist whose albumArtist tag contains separators, and rewrites them as backslash-delimited multi-value tags so that sync creates proper multi-artist links.

```bash
python3 scripts/fix_unsplit_multiartist.py                        # Dry run — full report
python3 scripts/fix_unsplit_multiartist.py --apply                # Fix feat + slash + semi
python3 scripts/fix_unsplit_multiartist.py --apply --only=feat    # Fix feat. only
python3 scripts/fix_unsplit_multiartist.py --report               # Show comma entries for manual review
```

### Categories

| Category | Pattern | Action |
|----------|---------|--------|
| `feat` | `X feat. Y`, `X ft. Y` | Split to `X\Y` |
| `slash` | `X / Y` (space-slash-space) | Split to `X\Y` |
| `semi` | `X; Y` | Split to `X\Y` |
| `backslash` | `X\Y` (already correct) | Resync only |
| `comma` | `X, Y` | Skipped (too ambiguous: band names vs. multi-artist) |

Known band names with separators (AC/DC, Earth Wind & Fire, etc.) are excluded automatically. Use `--report` to review comma entries manually.

---

## fix_tags.py

Generic tag-fixing utility. Reads a JSON mapping file and applies tag changes to audio files. Used internally by the other fix scripts. Runs on the machine where files are accessible (NAS or local).

```bash
MUSIC_DIR=/mnt/dmp/music/mainstream python3 scripts/fix_tags.py mapping.json --dry-run
MUSIC_DIR=/mnt/dmp/music/mainstream python3 scripts/fix_tags.py mapping.json --apply
```

### JSON formats

- Album artist rename: `{"mapping": {"path.mp3": "New Album Artist", ...}, "resync": [...]}`
- Metadata fix: `{"fixes": {"path.mp3": {"title": "...", "album": "..."}, ...}, "resync": [...]}`
- Multi-artist split: `{"splits": {"path.mp3": ["Artist1", "Artist2"], ...}, "resync": [...]}`

Supports MP3 (ID3), M4A (MP4), FLAC, OGG Vorbis, and Opus.

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
