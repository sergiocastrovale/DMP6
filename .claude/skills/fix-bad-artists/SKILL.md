---
name: fix-bad-artists
description: Fix wrong artist pages - read screenshots from problems/, diagnose via DB, queue fixes via audit+fix, resync
user-invocable: true
---

# Fix Bad Artists

Fix artist pages that show wrong names - corrupted TPE2 tags (track numbers, paths, years, garbage) and compound artists that should be split (`&`, `/`, `feat.`).

Use the `./audit` + `./fix` Rust pipeline, not Python scripts (those have been deleted).

---

## Background: Why This Happens

### Corrupted TPE2

The sync script creates one `Artist` record per unique `albumArtist` (TPE2) value. If TPE2 is `"02"` on track 2 of a Jeff Beck album, a phantom artist named `"02"` gets created. Since the `groupKey` for a `LocalRelease` is `meta:{slug(album)}:{year}:{slug(albumArtist)}`, every track with a different albumArtist becomes its own isolated single-track release. The phantom artist `"27"` can then accidentally match the real UK band "27" on MusicBrainz, pulling in their entire discography.

### Unsplit compound artists

The sync script's `split_artists()` intentionally never splits on `&` (too ambiguous - "Simon & Garfunkel") and only splits `/` with surrounding spaces ("AC/DC" is safe). So compound artists like "Jeff Beck & Eric Clapton" persist as a single artist entry.

The fix for both: write the correct TPE2 value back to the file and resync with `--overwrite`.

---

## Corruption Patterns to Recognize

| Pattern | Example TPE2 | Cause |
|---------|-------------|-------|
| Purely numeric 1-3 digits | `002`, `07`, `14` | Track number field leaked into TPE2 |
| Track-number prefix | `05 - Regurgitate` | Track num + title/artist concatenated |
| Full path string | `1966 - Junior Mance - I Believe to My Soul - 1966 @320` | Filename/folder info in TPE2 |
| Year only | `1996` | Year field leaked into TPE2 |
| Bitrate marker | `Artist Name @320` | Bitrate annotation in TPE2 |
| Song title as artist | `Haiku (For Makoto Sato)` | Title field in TPE2 |

---

## Phase 1: Read Screenshots and Identify Problems

Read all images from the `problems/` folder (or whatever path the user provides). For each screenshot:
- Note the artist name shown and what looks wrong about it
- Note the URL slug shown (used to find the artist in DB)
- Group by problem type (numeric name, track-number prefix, path string, compound artist, etc.)

Numeric names that are **legitimately real artists** and must not be touched:
- `"2002"` - Pamela and Randy Copus (new age project; ~378 tracks in library)
- `"3"` - Keith Emerson band (3 Emerson, Berry & Palmer)
- `"213"` - Snoop Dogg/Warren G/Nate Dogg group

---

## Phase 2: Diagnose in DB

For each problem artist, query the DB to understand the root cause:

```sql
SELECT a.name, ta.role, t."filePath", t."albumArtist", t.artist, t.album
FROM "Artist" a
JOIN "TrackArtist" ta ON ta."artistId" = a.id
JOIN "LocalReleaseTrack" t ON t.id = ta."trackId"
WHERE a.name = 'PROBLEM_NAME'
ORDER BY t."filePath";
```

**What to look for:**
- `albumArtist` column - the corrupted TPE2 value. If it equals the artist name, you've found the source
- `artist` (TPE1) column - often has the correct artist; use this as a correction signal
- `filePath` - identifies which folder/album the files belong to

**Categories:**
- **Tag corruption**: albumArtist is a track number, year, path, or garbage → `./audit --corrupted` + `./fix --corrupted`
- **Compound artist**: albumArtist contains `&`, `/`, `feat.` → `./audit --unsplit` + `./fix --unsplit`
- **MB credit artifact**: artist has 0 TrackArtist links, created via MB credit discovery → `./audit --orphans` + `./fix --orphans`
- **Legitimate artist**: artist name just looks odd but tags are correct → skip, inform user

---

## Phase 3: Run Audit + Fix

```bash
./audit --corrupted    # detect corrupted TPE2 issues
./audit --unsplit      # detect compound artist issues
./audit --orphans      # detect phantom/orphan artists
./audit               # detect all types at once
```

Review detected issues in the `/issues` UI - inspect proposed fixes, edit if needed, select rows and click "Fix Selected". Or from CLI after setting rows to PENDING via Prisma Studio:

```bash
./fix --corrupted      # write corrected albumArtist tags to files
./fix --unsplit        # write split albumArtist tags to files
./fix --orphans        # delete phantom artists from DB
```

---

## Phase 4: Resync Affected Artists

After any tag-writing fix, resync on the NAS via Docker (values from `.env`: `SSH_KEY_PATH`, `SERVER_USER`, `SERVER_HOST`, `DEPLOY_PATH`):

```bash
ssh -i $SSH_KEY_PATH $SERVER_USER@$SERVER_HOST 'docker exec dmp sync --only="ARTIST1;ARTIST2" --overwrite'
```

**This takes hours** for artists with large catalogues. Run in background:
- Jeff Beck: ~2h (1043 files, many related artists)
- Most artists: 5-30 min

The `--overwrite` flag re-reads all file tags and rebuilds the DB entries from scratch. Without it, the sync skips unchanged files and the corrupted DB records persist.

---

## Phase 5: Iterative Cleanup

After each resync batch, re-run the audit:

```bash
./audit
```

The first fix pass often reveals more issues. Keep running until the audit reports zero counts for the affected types.

If phantom links survive cleanup, delete them manually:
```sql
DELETE FROM "TrackArtist" ta
USING "Artist" a, "LocalReleaseTrack" t
WHERE ta."artistId" = a.id
  AND ta."trackId" = t.id
  AND a.name ~ '^\d{1,3}$'
  AND t."albumArtist" !~ '^\d{1,3}$'
  AND t."albumArtist" != a.name;
```

---

## Phase 6: Verify

```sql
-- Any phantom numeric artists remaining?
SELECT name FROM "Artist" WHERE name ~ '^\d{1,3}$' ORDER BY name;

-- Any remaining bad albumArtist patterns in tracks?
SELECT COUNT(*) FROM "LocalReleaseTrack" WHERE "albumArtist" ~ '^\d{1,3}$';

-- Any unsplit compound artists?
SELECT name FROM "Artist" WHERE name LIKE '% & %' OR name LIKE '% / %' ORDER BY name;
```

---

## Key Principles

- **DB is source of truth** - derive corrections from DB signals. Never use filesystem paths or hardcoded folder names.
- **MusicBrainz validates** - audit checks proposed corrections against MB before writing issues.
- **Iterate** - one fix pass often reveals more issues; keep running until clean.
- **NAS access** - music files are on the NAS (`SERVER_HOST` in `.env`), not mounted locally. Tag fixes run on the NAS via Docker.
