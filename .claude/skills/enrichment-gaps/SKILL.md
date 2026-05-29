---
name: enrichment-gaps
description: Reference for the 7 enrichment fields detected by ./audit --enrichment - what they map to in file metadata, which are auto-fixable, and what external tools address each gap.
user-invocable: true
---

# Enrichment Gaps

Reference skill for understanding, reviewing, and acting on enrichment issues surfaced at `/issues/enrichment`.

Enrichment gaps are detected per **release** (not per track). A release is flagged for a given field if *no track* in the release has that field populated.

---

## The 7 Fields

### 1. `mbRelease` - MusicBrainz Release Link

**What it checks**: whether `LocalRelease.releaseId` is non-null (i.e. the release has been matched to a MusicBrainz release).

**In file tags**: `MUSICBRAINZ_ALBUMID` (ID3v2.4: `TXXX:MusicBrainz Album Id`). The sync script reads this tag during indexing and uses it to skip the fuzzy-match phase.

**Fixable**: Yes - re-running `./sync --only="Artist" --overwrite` will attempt MB matching again. The per-row "Re-sync" button in the UI does exactly this (`./refresh --only="Artist Name"`).

**Why a release might be unlinked**:
- Sync ran before MB had this release (it's newly added)
- Tags had wrong/missing MB IDs and fuzzy match failed
- Album name or year differs from MB canonical data

**Badge**: amber (`bg-amber-900/40 text-amber-400`) - visually distinct because it's the only field with an automated fix path.

---

### 2. `bpm` - Beats Per Minute

**What it checks**: whether any track in the release has a non-null, non-zero `bpm` field in `LocalReleaseTrack`.

**In file tags**: `BPM` (ID3: `TBPM`). Stored as integer in DB.

**Fixable externally only**. Requires BPM analysis:
- **beets** with the `bpm` plugin (runs `bpmdetect` on audio)
- **SongKong** - analysis tab, BPM detection
- **MusicBrainz Picard** with the BPM Analyser plugin

**Badge**: zinc (non-fixable), `?` popover with the above guidance.

---

### 3. `mood` - Mood Analysis Tags

**What it checks**: whether any track in the release has at least one key starting with `MOOD_` in its `metadata` JSONB column.

**In file tags**: multiple `TXXX` frames with keys like `MOOD_ACOUSTIC`, `MOOD_AGGRESSIVE`, `MOOD_ELECTRONIC`, `MOOD_HAPPY`, `MOOD_PARTY`, `MOOD_RELAXED`, `MOOD_SAD`. Each value is a float 0.0–1.0. Written by SongKong's mood analysis engine.

**Detection in SQL**: uses `jsonb_object_keys(t.metadata) k WHERE k ~ '^MOOD_'` - dynamic because the specific mood keys present vary.

**Fixable externally only**:
- **SongKong** - includes mood analysis (proprietary, paid)
- **beets** with the AcousticBrainz plugin (AcousticBrainz service shut down 2022 - this path is now dead)

**Badge**: zinc, `?` popover.

---

### 4. `acousticId` - AcousticID Fingerprint

**What it checks**: whether any track has `ACOUSTID_ID` or `ACOUSTID_FINGERPRINT` in its `metadata` JSONB.

**In file tags**: `TXXX:Acoustid Id` and/or `TXXX:Acoustid Fingerprint`. The fingerprint is generated from audio content by `fpcalc`; the ID is the server-assigned UUID from the AcousticID service.

**Fixable externally only**:
- **MusicBrainz Picard** - "Lookup" via fingerprint scan (uses fpcalc internally)
- **fpcalc CLI** - generates fingerprints for submission (`chromaprint` library)
- **beets** with the `chroma` plugin

**Badge**: zinc, `?` popover.

---

### 5. `discogs` - Discogs Identifiers

**What it checks**: whether any track has a key starting with `WWW DISCOGS` in its `metadata` JSONB.

**In file tags**: `TXXX` frames with keys `WWW DISCOGS_ARTIST` and `WWW DISCOGS_RELEASE`, values are full Discogs URLs (e.g. `https://www.discogs.com/artist/123`).

**Note**: this is NOT the standard `WOAS`/`WOAR` URL frame - it's SongKong's proprietary convention using `TXXX` with a `WWW ` prefix.

**Fixable externally only**:
- **SongKong** - tags with Discogs artist and release URLs

**Badge**: zinc, `?` popover.

---

### 6. `bandcamp` - Bandcamp URL

**What it checks**: whether any track has `WWW BANDCAMP_ARTIST` in its `metadata` JSONB.

**In file tags**: `TXXX:WWW BANDCAMP_ARTIST` - the artist's Bandcamp page URL. Written by SongKong where available.

**Fixable externally only**:
- **SongKong** - adds Bandcamp links when the release exists on Bandcamp

Not all artists have Bandcamp presence. Missing Bandcamp is often correct (not a gap), so treat this field as low-priority.

**Badge**: zinc, `?` popover.

---

### 7. `wikipedia` - Wikipedia URL

**What it checks**: whether any track has `WWW WIKIPEDIA_ARTIST` in its `metadata` JSONB.

**In file tags**: `TXXX:WWW WIKIPEDIA_ARTIST` - the artist's Wikipedia page URL. Written by SongKong.

**Fixable externally only**:
- **SongKong** - pulls Wikipedia artist links from MusicBrainz artist relationships

**Badge**: zinc, `?` popover.

---

## UI Behaviour Summary

| Field | Badge color | Has `?` popover | Per-row fix button |
|-------|------------|-----------------|-------------------|
| mbRelease | Amber | No | Yes - "Refresh" |
| bpm | Zinc | Yes | No |
| mood | Zinc | Yes | No |
| acousticId | Zinc | Yes | No |
| discogs | Zinc | Yes | No |
| bandcamp | Zinc | Yes | No |
| wikipedia | Zinc | Yes | No |

The "Refresh" button only appears on a row when `missingFields` includes `mbRelease` AND `item.artist` is non-null. It calls `./refresh --only="Artist Name"` via the in-app terminal.

There is no SelectionBar on `/issues/enrichment` - no bulk fix action exists.

---

## DB Detection SQL Pattern

The enrichment audit (`scripts/audit/src/enrichment.rs`) uses a single CTE query that evaluates all 7 fields per release in one pass:

```sql
WITH release_check AS (
  SELECT
    lr.id,
    lr."artistId",
    lr.title,
    lr.year,
    NOT EXISTS (SELECT 1 FROM "LocalReleaseTrack" t WHERE t."localReleaseId" = lr.id
                AND t.bpm IS NOT NULL AND t.bpm > 0) AS missing_bpm,
    NOT EXISTS (SELECT 1 FROM "LocalReleaseTrack" t WHERE t."localReleaseId" = lr.id
                AND t.metadata IS NOT NULL
                AND EXISTS (SELECT 1 FROM jsonb_object_keys(t.metadata) k WHERE k ~ '^MOOD_')) AS missing_mood,
    -- ... similar for acousticId, discogs, bandcamp, wikipedia
    lr."releaseId" IS NULL AS missing_mb_release
  FROM "LocalRelease" lr
  WHERE EXISTS (SELECT 1 FROM "LocalReleaseTrack" t WHERE t."localReleaseId" = lr.id)
)
SELECT * FROM release_check
WHERE missing_bpm OR missing_mood OR ...
```

Releases with no tracks are excluded (the outer `WHERE EXISTS`).

---

## Prioritisation Guidance

When reviewing enrichment gaps:

1. **mbRelease** first - it's the only automated fix and unblocks MB-dependent features (track matching, status badges, etc.)
2. **mood + bpm** - high value for the `explore` feature (4-slider discovery uses these if present)
3. **acousticId** - useful for duplicate detection and catalogue integrity
4. **discogs / bandcamp / wikipedia** - informational enrichment, low urgency
