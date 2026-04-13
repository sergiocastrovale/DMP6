---
name: fix-bad-artists
description: Fix wrong artist pages — read screenshots from problems/, diagnose via DB, fix tags, resync, cleanup
user-invocable: true
---

# Fix Bad Artists

Fix artist pages that show wrong names — corrupted TPE2 tags (track numbers, paths, years, garbage) and compound artists that should be split (`&`, `/`, `feat.`).

All handled by a single script: `scripts/fix_artist_names.py`.

---

## Background: Why This Happens

### Corrupted TPE2

The sync script creates one `Artist` record per unique `albumArtist` (TPE2) value. If TPE2 is `"02"` on track 2 of a Jeff Beck album, a phantom artist named `"02"` gets created. Since the `groupKey` for a `LocalRelease` is `meta:{slug(album)}:{year}:{slug(albumArtist)}`, every track with a different albumArtist becomes its own isolated single-track release. The phantom artist `"27"` can then accidentally match the real UK band "27" on MusicBrainz, pulling in their entire discography.

### Unsplit compound artists

The sync script's `split_artists()` intentionally never splits on `&` (too ambiguous — "Simon & Garfunkel") and only splits `/` with surrounding spaces ("AC/DC" is safe). The sync's `try_split_tag()` CAN split `&` during the MB sync phase but only when an anchor primary artist is already confirmed — many artists never reach that code path. So compound artists like "Jeff Beck & Eric Clapton" persist as a single artist entry.

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
- `"2002"` — Pamela and Randy Copus (new age project; ~378 tracks in library)
- `"3"` — Keith Emerson band (3 Emerson, Berry & Palmer)
- `"213"` — Snoop Dogg/Warren G/Nate Dogg group

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
- `albumArtist` column — the corrupted TPE2 value. If it equals the artist name, you've found the source
- `artist` (TPE1) column — often has the correct artist; use this as a correction signal
- `filePath` — identifies which folder/album the files belong to

**Categories:**
- **Tag corruption**: albumArtist is a track number, year, path, or garbage → `fix_artist_names.py --only=corrupted`
- **Compound artist**: albumArtist contains `&`, `/`, `feat.` → `fix_artist_names.py --only=separators`
- **MB credit artifact**: artist has 0 TrackArtist links, created via MB credit discovery → delete from DB directly
- **Legitimate artist**: artist name just looks odd but tags are correct → skip, inform user

---

## Phase 3: Run fix_artist_names.py

```bash
python3 scripts/fix_artist_names.py                      # dry run — all modes
python3 scripts/fix_artist_names.py --only=corrupted     # only garbage TPE2
python3 scripts/fix_artist_names.py --only=separators    # only compound splitting
python3 scripts/fix_artist_names.py --skip-mb            # skip MB validation
```

### What the Script Does

**Corrupted mode** — queries for tracks where albumArtist matches garbage patterns (`^\d{1,3}$`, track-number prefix, path strings, year = albumArtist, bitrate markers). Resolution signals in priority order:

1. **Majority vote**: non-corrupt albumArtist from other tracks in same release
2. **Linked artists**: `LocalReleaseArtist` records with tc >= 3, joined with `\`
3. **Folder consensus**: most common non-corrupt albumArtist in artist folder (prefers exact folder name match)
4. **TPE1 consensus**: most common `artist` tag value across the release's tracks

Pre-checks numeric albumArtist against MB before correction (catches band "3", "2002").

**Separators mode** — queries all artists with `&`, `/`, `feat.` in their name. Two-phase MB validation:

1. **Full name check**: `mb_artist_exists(full_name)` → if confirmed single MB artist (AC/DC, Kool & The Gang), skip
2. **Parts check**: split by separator, check each part → if >50% confirmed MB artists, mark for split

Maintains a `KNOWN_SINGLE_ARTISTS` pre-filter (~40 entries) for fast skipping before MB API calls.

**Cleanup** — runs automatically with `--apply`. Removes phantom artist links, orphan artists + images, orphan MB releases, empty releases. Updates statistics.

### Review Dry Run Output Carefully

Check for:
- Are proposed corrections real artist names?
- Any legitimate numeric artists being flagged? (band `"3"`, `"2002"`, `"213"`)
- Corrections truncated or with garbage characters?
- Compound artists incorrectly flagged for splitting? (known single artists should be in the pre-filter or caught by MB full-name check)

Present dry run results to the user and get approval before applying.

### Known Limitations

**Corrupted mode:**
- Single-track isolated releases: when every track has a different track number as TPE2, majority vote and linked artists fail. Folder consensus is the primary fallback.
- Folder consensus with mixed content: compilation albums in a solo artist folder can return a compound name.
- Year-as-albumArtist: only detected when the year field is populated in DB.

**Separators mode:**
- MB full-name check may return false positives if a collaboration happens to be registered as a single MB entity.
- Bare `&` without spaces (e.g. "Artist1&Artist2") may not split correctly if the parts are too short.
- The >50% threshold means a 3-part name where only 1 part matches is skipped.

**SQL regex escaping**: queries use Python raw strings (`r'''...'''`), not E-strings. PostgreSQL E-strings would turn `\\d` into literal `\d`, breaking the regex.

```bash
python3 scripts/fix_artist_names.py --apply              # fix tags + cleanup DB
```

---

## Phase 4: Resync Affected Artists

The script prints the resync command. Run it on the NAS via Docker (values from `.env`: `SSH_KEY_PATH`, `SERVER_USER`, `SERVER_HOST`, `DEPLOY_PATH`):

```bash
ssh -i $SSH_KEY_PATH $SERVER_USER@$SERVER_HOST 'docker run --rm --env-file $DEPLOY_PATH/.env --add-host=host.docker.internal:host-gateway -e PROJECT_ROOT=/app -e MUSIC_DIR=/music -v /mnt/dmp/music/mainstream:/music:ro -v $DEPLOY_PATH/img:/app/web/public/img dmp-scripts:latest dmp-sync --only="ARTIST1;ARTIST2" --overwrite'
```

**This takes hours** for artists with large catalogues. Run in background:
- Jeff Beck: ~2h (1043 files, many related artists)
- Most artists: 5-30 min

The `--overwrite` flag re-reads all file tags and rebuilds the DB entries from scratch. Without it, the sync skips unchanged files and the corrupted DB records persist.

---

## Phase 5: Iterative Cleanup

After each resync batch, re-run the scanner:

```bash
python3 scripts/fix_artist_names.py
```

Why: the first fix pass often reveals more issues. Some albums have multiple tracks with different corrupt TPE2 values. After resyncing, the DB is rebuilt and new issues surface. Keep running until the script reports no issues.

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

## Manual Fallback: When the Script Fails

If `fix_artist_names.py` reports wrong corrections, reports nothing, or crashes:

### Step 1: Find bad tracks

```sql
SELECT t.id, t."filePath", t."albumArtist", t.artist, t.album, t.year
FROM "LocalReleaseTrack" t
WHERE t."albumArtist" ~ '^\d{1,3}$'
   OR t."albumArtist" ~ '^\d{1,3}\s*-\s*\w'
   OR (t.year IS NOT NULL AND t."albumArtist" = CAST(t.year AS TEXT))
   OR t."albumArtist" ~ '@\d{2,3}$'
ORDER BY t."filePath";
```

### Step 2: Find the correct albumArtist per folder

```sql
SELECT "albumArtist", COUNT(*) as cnt
FROM "LocalReleaseTrack"
WHERE "filePath" LIKE 'Jeff Beck/%'
  AND "albumArtist" !~ '^\d{1,3}$'
GROUP BY "albumArtist"
ORDER BY cnt DESC;
```

### Step 3: Build JSON and apply with fix_tags.py

```json
{
  "mapping": {
    "Jeff Beck/1968 - Truth/01 Shapes of Things.mp3": "Jeff Beck"
  },
  "resync": ["Jeff Beck"]
}
```

For multi-artist splits, use the "splits" format:
```json
{
  "splits": {
    "path/to/file.mp3": ["Artist1", "Artist2"]
  },
  "resync": ["Artist1", "Artist2"]
}
```

```bash
MUSIC_DIR=/mnt/dmp/music/mainstream python3 scripts/fix_tags.py mapping.json --apply
```

If MUSIC_DIR is on NAS:
```bash
scp -i $SSH_KEY_PATH mapping.json $SERVER_USER@$SERVER_HOST:/tmp/
ssh -i $SSH_KEY_PATH $SERVER_USER@$SERVER_HOST 'MUSIC_DIR=/mnt/dmp/music/mainstream python3 /tmp/fix_tags.py /tmp/mapping.json --apply'
```

---

## Key Principles

- **DB is source of truth** — derive corrections from DB signals. Never use filesystem paths or hardcoded folder names.
- **MusicBrainz validates** — always check corrections against MB before applying (use `--skip-mb` if API is overloaded).
- **Dry run first** — always show the user what will change before `--apply`.
- **Iterate** — one fix pass often reveals more issues; keep running until clean.
- **NAS access** — music files are on the NAS (`SERVER_HOST` in `.env`), not mounted locally. Tag fixes go through SSH. Sync runs via Docker on NAS.
- **No E-string in SQL regexes** — use Python raw strings (`r'''...'''`) when embedding SQL with `\d`, `\s`, etc.
