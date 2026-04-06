# Post-Sync Routine

After syncing the library in batches (e.g. `./sync --from=a --to=cz`), run this routine to catch and fix errors before moving to the next batch.

Claude Code knows about this routine in its memories and CLAUDE.md - point to this file and ask to performe the post sync routine and it will do it.

## Phase 1: Error Analysis

Check `errors.log` for issues from the sync run. Errors are grouped by category:

| Category | Cause |
|----------|-------|
| Invalid encoding | ID3 tags not encoded as UTF-8 |
| Invalid item size | Corrupt tag frame sizes |
| Invalid MPEG frame | Damaged audio frames |
| APE UTF-8 error | Malformed APE tags alongside ID3 |
| Missing artist | No TPE1 (artist) tag in file |

```bash
# Claude analyses errors.log and presents findings by category.
# You review and approve which fixes to apply.
```

## Phase 2: Fix Errors

Apply fixes using [`fix_sync_errors.py`](scripts/helpers.md#fix_sync_errorspy):

```bash
python3 scripts/fix_sync_errors.py              # Dry run
python3 scripts/fix_sync_errors.py --apply      # Apply all fixes
python3 scripts/fix_sync_errors.py --apply --only=encoding  # One category
```

Fix methods per category:
- **Invalid encoding** — strip + rewrite as ID3v2.4 UTF-8 (mutagen)
- **Invalid item size / MPEG frame** — lossless remux with ffmpeg
- **APE UTF-8** — strip APE tags, keep ID3v2
- **Missing artist** — copy from TXXX:ARTISTS or TXXX:ALBUM_ARTISTS into TPE1/TPE2
- **Truly corrupt** — flag for manual deletion or re-download

Resync all affected artists after fixing:

```bash
./sync --only="Artist1;Artist2;Artist3" --overwrite
```

## Phase 3: Ampersand Artist Analysis

Scan for compound artist folders (`&`, `/` in name) that should be split:

```bash
python3 scripts/check_ampersand_artists.py
# Results → separator_analysis.log
```

See [`check_ampersand_artists.py`](scripts/helpers.md#check_ampersand_artistspy) for details.

Verdicts:
- **MULTIPLE** — confirmed separate artists (multiple MB IDs or `;` in sort names) — fix tags
- **LIKELY_MULTIPLE** — needs manual MusicBrainz research
- **SINGLE** — legitimate single artist name (e.g. "Simon & Garfunkel") — no action

## Phase 4: Fix Ampersand Artists

For confirmed MULTIPLE artists, replace the ambiguous separator with `\\` in TPE2 (album artist) across all MP3s in the folder.

For one-off fixes, use [`fix_compound_artists.py`](scripts/helpers.md#fix_compound_artistspy):

```bash
python3 scripts/fix_compound_artists.py          # Dry run
python3 scripts/fix_compound_artists.py --apply  # Apply fixes
```

Then resync:

```bash
./sync --only="Artist1;Artist2" --overwrite
```

## Phase 5: Fix Compound TPE2 Tags (Library-Wide)

After several sync batches, compound artists accumulate in the DB — artists whose TPE2 tags use ambiguous separators (`/`, ` & `, `, `) that the sync doesn't split at index time. These show up in the browse view as "Artist1/Artist2" or "Artist1 & Artist2".

Use [`fix_compound_tpe2.py`](scripts/helpers.md#fix_compound_tpe2py) to fix them all at once:

```bash
python3 scripts/fix_compound_tpe2.py                    # Dry run — show what would change
python3 scripts/fix_compound_tpe2.py --apply             # Apply fixes
python3 scripts/fix_compound_tpe2.py --apply --resync    # Apply + print resync command
```

The script:
1. Queries the DB for all artists without a MusicBrainz ID whose names contain `/`, ` & `, `, `, or ` w/ `
2. Finds the release folder paths for each
3. Reads TPE2 from files and replaces the compound name's separator with `\\`
4. Handles mixed separators (e.g. "A, B & C" → "A\\B\\C") and broken tags (e.g. "lbumArtist/Name")

After fixing, resync all affected artist folders:

```bash
./sync --only="Folder1;Folder2;..." --overwrite
```

## Phase 6: Verify & Loop

Repeat from Phase 1 until `errors.log` is clean and no new compound artists appear.

## Quick Reference

| Command | What it does |
|---------|-------------|
| "run the routine" | Start from Phase 1 (full analysis, fixes, verification) |
| "check errors" | Phase 1 only (analyse + present findings) |
| "fix the errors" | Skip to Phase 2 (apply fixes + resync) |
| "check ampersand" | Phase 3 (analyse separator_analysis.log) |
| "fix ampersand" | Skip to Phase 4 (split tags + resync) |
