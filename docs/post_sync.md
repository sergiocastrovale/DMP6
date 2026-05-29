# Post-Sync Routine

After running `./index && ./sync` in batches, run this routine to catch and fix errors before moving to the next batch.

## Phase 1: Check Encoding Errors

If `./index` logged errors, check `errors.log` for files that failed:

| Category | Cause | Manual fix |
|----------|-------|-----|
| Invalid encoding | ID3 tags not UTF-8 | Strip + rewrite as ID3v2.4 with `mutagen` |
| Invalid item size | Corrupt tag frame sizes | Lossless remux with `ffmpeg` |
| Invalid MPEG frame | Damaged audio frames | Lossless remux with `ffmpeg` |
| APE UTF-8 error | Malformed APE tags | Strip APE, keep ID3v2 |
| Missing artist | No TPE1 tag | Copy from TXXX:ARTISTS into TPE1 |

After fixing files manually, re-index the affected artists:

```bash
./refresh --only="Artist1;Artist2"
```

## Phase 2: Detect and Fix Metadata Issues

Run the audit to detect all issue types and write results to the DB:

```bash
./audit
```

Then open `/issues` in the browser to review, edit proposed fixes, and apply them type by type. Each type has a "Fix Selected" button that queues the selected rows and runs `./fix --{type}`.

Alternatively, from the command line:

```bash
# Queue all DETECTED rows of a type (via API or Prisma Studio)
./fix --corrupted    # Fix corrupted albumArtist tags
./fix --unsplit      # Split compound artists in TPE2, preserve compound in TPE1
./fix --orphans      # Delete phantom/orphan artists from DB
./fix --duplicates   # Merge duplicate artists
./fix --missing      # Write auto-derivable missing fields
```

After any tag-writing fix, re-index and re-sync:

```bash
./refresh --only="Artist1;Artist2"
# or use the "Refresh" button in the /issues UI
```

## Phase 3: Verify

Re-run the audit and verify counts drop:

```bash
./audit
# Check /issues - all counts should be 0 or near-0
```

Repeat from Phase 1 if new issues surface.

## Quick Reference

| Command | What it does |
|---------|-------------|
| "run the routine" | Full Phase 1–3 |
| "check errors" | Phase 1 - analyse errors.log |
| "fix the errors" | Phase 1 - apply encoding fixes |
| "run audit" / "detect issues" | Phase 2 - `./audit` |
| "fix issues" | Phase 2 - `./fix --{type}` for pending rows |
| "fix corrupted tags" | `./fix --corrupted` |
| "fix compound artists" | `./fix --unsplit` |
| "clean up orphans" | `./fix --orphans` |
