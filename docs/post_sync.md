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

## Phase 3: Fix Artist Names

Fix corrupted albumArtist tags (garbage in TPE2) and compound artists (`&`, `/`, `feat.`) in a single pass. Validates all changes against MusicBrainz.

```bash
python3 scripts/fix_artist_names.py                      # Dry run — show all issues
python3 scripts/fix_artist_names.py --only=corrupted     # Only garbage TPE2
python3 scripts/fix_artist_names.py --only=separators    # Only compound splitting
python3 scripts/fix_artist_names.py --apply              # Apply fixes + cleanup DB
```

See [`fix_artist_names.py`](scripts/helpers.md#fix_artist_namespy) for details on detection patterns, correction logic, and MusicBrainz validation.

After fixing, resync affected artist folders:

```bash
./sync --only="Artist1;Artist2" --overwrite
```

## Phase 4: Cleanup (standalone)

If you need to run DB cleanup without tag fixes (e.g. after a manual resync):

```bash
python3 scripts/fix_artist_names.py --cleanup            # Dry run
python3 scripts/fix_artist_names.py --cleanup --apply    # Delete orphans + empty releases
```

## Phase 5: Verify & Loop

Repeat from Phase 1 until `errors.log` is clean and `fix_artist_names.py` reports no issues.

## Quick Reference

| Command | What it does |
|---------|-------------|
| "run the routine" | Start from Phase 1 (full analysis, fixes, verification) |
| "check errors" | Phase 1 only (analyse + present findings) |
| "fix the errors" | Skip to Phase 2 (apply fixes + resync) |
| "fix artist names" | Phase 3 (corrupted TPE2 + compound artists + cleanup) |
| "cleanup" | Phase 4 only (DB cleanup) |
