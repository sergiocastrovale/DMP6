# PRD: Explore Page

## Overview

The Explore page is a discovery feature that randomizes track selection based on slider-controlled criteria and immediately plays the result. Users adjust four mood/preference sliders, hit "Explore", and the system picks a weighted-random track matching their criteria.

---

## Data Landscape (as of 2026-03-02)

| Metric | Count | Coverage |
|---|---|---|
| Total tracks | 4,982 | 100% |
| Have `IntegerBpm` in metadata | 3,740 | 75% |
| Have MOOD_* tags in metadata | 3,722 | 74.7% |
| Have raw genre tag | 4,880 | 98% |
| Normalized genres (MusicBrainz) | 140 | Artist-level |

### MOOD Tags Available (0-99 scale, stored in `LocalReleaseTrack.metadata` JSONB)

| Key | Range | Notes |
|---|---|---|
| `MOOD_HAPPY` | 0-99 | |
| `MOOD_SAD` | 0-95 | |
| `MOOD_RELAXED` | 0-99 | |
| `MOOD_AGGRESSIVE` | 0-99 | |
| `MOOD_PARTY` | 0-99 | |
| `MOOD_DANCEABILITY` | 0-99 | |
| `MOOD_ELECTRONIC` | 0-99 | |
| `MOOD_ACOUSTIC` | 0-99 | |
| `MOOD_INSTRUMENTAL` | 0-99 | |
| `MOOD_VALENCE` | -10 to 99 | Can be negative |
| `MOOD_AROUSAL` | -1 to 99 | 2,247 tracks have negative values — treat negatives as 0 |

### BPM

Stored as `IntegerBpm` (NOT `BPM`) in the `metadata` JSONB column. Values observed: 89-172+ BPM, roughly normal distribution centered around 120-130.

### Genre Tags

Raw `genre` field on `LocalReleaseTrack` contains multi-value strings with separators like ` / `, `, `, ` / `. Examples:
- `"Alternative Rock / Rapcore / Funk / Ragga-Metal"`
- `"Downtempo, Instrumental Hip-Hop"`
- `"Rock"`
- `"Symphonic Black Metal / Industrial/Electronic Metal"`

Must tokenize by ` / ` and `, ` to get individual genre terms. Be careful: `Industrial/Electronic` uses `/` without spaces — only split on ` / ` (with spaces).

---

## Sliders

### Shared Slider Component (`components/Slider.vue`)

A reusable range slider with:
- `min`, `max`, `step` props
- `modelValue` (v-model)
- `labels`: array of `{ value: number, text: string }` for labeled stops
- `leftLabel` and `rightLabel` props for the two extremes displayed at the edges
- Styled with amber accent (`accent-amber-500`), dark zinc track
- Shows the current label text above/below the thumb or centered above the slider
- Snap-to-stops behavior when labels are defined
- Emits on change (not on every input) to avoid excessive API calls

### Slider 1: "I'm feeling..." (Energy/Mood)

Range: 0-9, 10 labeled stops:

| Value | Label | BPM Target | Key Moods (high) | Key Moods (low) |
|---|---|---|---|---|
| 0 | Sleepy | 60-85 | RELAXED=90 | AGGRESSIVE=0, PARTY=0 |
| 1 | Melancholic | 65-95 | SAD=80, RELAXED=50 | HAPPY=5, PARTY=0 |
| 2 | Calm | 70-100 | RELAXED=85, HAPPY=30 | AGGRESSIVE=0 |
| 3 | Reflective | 80-115 | RELAXED=60, VALENCE=30 | AGGRESSIVE=5, PARTY=10 |
| 4 | Chill | 85-120 | RELAXED=50, HAPPY=50, DANCEABILITY=40 | AGGRESSIVE=5 |
| 5 | Groovy | 95-130 | DANCEABILITY=70, PARTY=60, HAPPY=65 | SAD=5 |
| 6 | Upbeat | 110-145 | HAPPY=80, PARTY=75, DANCEABILITY=80 | SAD=0 |
| 7 | Energetic | 120-160 | PARTY=85, AROUSAL=85, DANCEABILITY=85 | RELAXED=5 |
| 8 | Fierce | 135-180 | AGGRESSIVE=90, AROUSAL=90 | RELAXED=0, HAPPY=60 |
| 9 | Powerful | 145-200 | AGGRESSIVE=95, AROUSAL=95, PARTY=70 | RELAXED=0 |

Left label: "Tired", Right label: "Powerful"

### Slider 2: "Era"

Range: 0-9, 10 labeled stops:

| Value | Label | Year Range |
|---|---|---|
| 0 | 60s | 1960-1969 |
| 1 | 70s | 1970-1979 |
| 2 | 80s | 1980-1989 |
| 3 | 90s | 1990-1999 |
| 4 | Y2K | 2000-2004 |
| 5 | Late 2000s | 2005-2009 |
| 6 | Early 2010s | 2010-2014 |
| 7 | Late 2010s | 2015-2019 |
| 8 | 2020s | 2020-2024 |
| 9 | Now | 2025+ |

Left label: "Classic", Right label: "Modern"

**Year source**: `LocalReleaseTrack.year` column (direct field, not in metadata).

**Handling**: If slider is at a position, prefer tracks from that era but allow +-1 decade as a secondary range with reduced score. If a track has no year, it gets 50% of the era score (neutral, don't exclude).

### Slider 3: "Discovery"

Range: 0-9

| Value | Label | Play Count Preference |
|---|---|---|
| 0 | Comfort | Strongly prefer high playCount |
| 1 | Familiar | Prefer high playCount |
| 2 | Known | Slight preference for played tracks |
| 3 | Mixed+ | Slight lean toward played |
| 4 | Balanced | No preference |
| 5 | Balanced- | Slight lean toward unplayed |
| 6 | Fresh | Slight preference for unplayed |
| 7 | New | Prefer low/zero playCount |
| 8 | Hidden | Strongly prefer zero playCount |
| 9 | Uncharted | Only tracks with playCount = 0 |

Left label: "Comfort Zone", Right label: "Uncharted"

**Scoring**: Use `playCount` field on `LocalReleaseTrack`. Score calculation:
- At "Uncharted" (9): Only include tracks where `playCount === 0`
- At "Comfort" (0): Score = `min(playCount / 20, 1.0)` (caps at 20 plays)
- Middle values interpolate between these extremes

### Slider 4: "Sound"

Range: 0-9

| Value | Label | Acoustic Target | Electronic Target |
|---|---|---|---|
| 0 | Acoustic | 90+ | 0-10 |
| 1 | Unplugged | 75-90 | 0-20 |
| 2 | Natural | 60-80 | 10-30 |
| 3 | Warm | 45-65 | 20-45 |
| 4 | Balanced | 35-55 | 35-55 |
| 5 | Hybrid | 25-45 | 45-65 |
| 6 | Produced | 15-35 | 55-75 |
| 7 | Synthy | 5-25 | 70-85 |
| 8 | Digital | 0-15 | 80-95 |
| 9 | Electronic | 0-10 | 90+ |

Left label: "Acoustic", Right label: "Electronic"

**Primary data**: `MOOD_ACOUSTIC` and `MOOD_ELECTRONIC` from metadata.
**Fallback**: Genre-to-acoustic mapping (see Genre Maps below).

---

## Scoring Algorithm

### Overview

For each candidate track, compute a **composite score** from 0 to 1:

```
compositeScore = (energyScore * 0.40) + (eraScore * 0.20) + (familiarityScore * 0.20) + (soundScore * 0.20)
```

**Energy has double weight** because it's the primary discovery axis.

### Confidence Multiplier

Each score component has a confidence level:
- **Direct metadata available** (BPM/mood tags present): confidence = 1.0
- **Genre-only fallback** (no mood/BPM tags): confidence = 0.75
- **No data at all** (no genre, no mood, no BPM): confidence = 0.50

The per-component score is multiplied by its confidence:
```
adjustedScore = rawScore * confidence
```

### Energy Score Calculation

**Step 1 — BPM sub-score (50% of energy score):**
```
targetBpmMin, targetBpmMax = lookup from slider position
trackBpm = metadata.IntegerBpm (parsed as integer)

if trackBpm is within [targetBpmMin, targetBpmMax]:
  bpmScore = 1.0
elif trackBpm is within +-15 of range:
  bpmScore = 0.5
else:
  bpmScore = max(0, 1 - abs(trackBpm - nearestRangeEdge) / 50)

if no BPM data:
  use genre energy map → estimate BPM range → score at 0.75 confidence
```

**Step 2 — Mood sub-score (50% of energy score):**
For each mood dimension with a target value at this slider position:
```
moodDimScore = 1 - abs(trackMoodValue - targetValue) / 100
```
Average across all relevant mood dimensions (only those with target > 0).

If no mood data: use genre energy map → estimate mood profile → score at 0.75 confidence.

```
energyScore = (bpmScore * 0.5 + moodScore * 0.5) * confidence
```

### Era Score Calculation

```
targetYearMin, targetYearMax = lookup from slider position
trackYear = LocalReleaseTrack.year

if trackYear is within [targetYearMin, targetYearMax]:
  eraScore = 1.0
elif trackYear is within +-5 years of range:
  eraScore = 0.6
elif trackYear is within +-10 years:
  eraScore = 0.3
else:
  eraScore = 0.0

if no year data:
  eraScore = 0.5 (neutral)
```

### Familiarity Score Calculation

```
sliderValue = 0..9
trackPlayCount = LocalReleaseTrack.playCount

// Normalize play count to 0-1 (cap at 20)
normalizedPlays = min(playCount / 20, 1.0)

// Slider 0 = want high plays, slider 9 = want zero plays
targetFamiliarity = sliderValue / 9  // 0 = familiar, 1 = uncharted

if sliderValue === 9 and playCount > 0:
  familiarityScore = 0  // Hard filter: only unplayed
else:
  // Distance between what we want and what we have
  distance = abs(targetFamiliarity - (1 - normalizedPlays))
  familiarityScore = 1 - distance
```

### Sound Score Calculation

```
targetAcoustic, targetElectronic = lookup from slider position
trackAcoustic = metadata.MOOD_ACOUSTIC (0-99)
trackElectronic = metadata.MOOD_ELECTRONIC (0-99)

acousticDist = abs(trackAcoustic - targetAcoustic) / 100
electronicDist = abs(trackElectronic - targetElectronic) / 100
soundScore = 1 - (acousticDist + electronicDist) / 2

if no mood data:
  use genre acoustic map → score at 0.75 confidence
```

### Track Selection (Weighted Random)

Do NOT just pick the highest-scoring track — that would feel repetitive.

1. Score all candidates
2. Sort by composite score descending
3. Take top 15% of candidates (minimum 20 tracks)
4. Apply **weighted random selection** within this pool: probability proportional to score
5. Exclude tracks from the current session's history (`excludeIds`)

```
weight(track) = track.compositeScore ^ 2  // square to bias toward better matches
probability(track) = weight(track) / sum(all weights)
```

---

## Genre Maps

### Genre → Energy Score (0-100)

Used as fallback when BPM/mood tags are missing.

```typescript
const GENRE_ENERGY_MAP: Record<string, number> = {
  // Very low (0-20)
  'ambient': 10, 'new age': 10, 'chillout': 15, 'lounge': 15,
  'downtempo': 20, 'classical': 15, 'sleep': 5,

  // Low (20-35)
  'folk': 25, 'acoustic': 25, 'singer-songwriter': 25, 'bossa nova': 25,
  'jazz': 30, 'blues': 30, 'soul': 35, 'country': 30, 'soft rock': 30,
  'trip-hop': 30, 'shoegaze': 35, 'dream pop': 30,

  // Low-medium (35-50)
  'r&b': 40, 'reggae': 40, 'indie': 40, 'pop': 45, 'art rock': 45,
  'alternative': 45, 'synthpop': 45, 'funk': 50, 'pop rock': 45,
  'indie rock': 45, 'new wave': 45, 'fusion': 45, 'progressive rock': 50,

  // Medium-high (50-70)
  'rock': 55, 'hip-hop': 55, 'hip hop': 55, 'rap': 60, 'trap': 60,
  'hard rock': 65, 'punk rock': 65, 'post-punk': 55, 'grunge': 60,
  'garage rock': 65, 'southern rock': 55, 'stoner rock': 55,
  'alternative rock': 55, 'post-grunge': 60, 'rapcore': 65,

  // High (70-85)
  'metal': 75, 'heavy metal': 75, 'alternative metal': 70,
  'nu metal': 75, 'industrial': 75, 'punk': 70, 'hardcore': 80,
  'industrial metal': 80, 'noise rock': 70, 'funk metal': 70,
  'drum and bass': 80, 'hardstyle': 85, 'gabber': 90,

  // Very high (85-100)
  'black metal': 90, 'death metal': 90, 'thrash metal': 85,
  'chaotic hardcore': 90, 'grindcore': 95, 'power metal': 80,
  'speed metal': 90, 'metalcore': 85, 'deathcore': 90,
}
```

### Genre → Acoustic Score (0=acoustic, 100=electronic)

```typescript
const GENRE_ACOUSTIC_MAP: Record<string, number> = {
  // Acoustic (0-25)
  'acoustic': 5, 'folk': 10, 'singer-songwriter': 10, 'classical': 5,
  'bossa nova': 10, 'country': 15, 'blues': 15, 'acoustic rock': 15,
  'unplugged': 5,

  // Mostly acoustic (25-40)
  'jazz': 25, 'soul': 30, 'r&b': 35, 'soft rock': 25, 'art rock': 35,
  'southern rock': 25, 'reggae': 30,

  // Mixed (40-60)
  'rock': 40, 'pop': 50, 'indie': 45, 'alternative': 45,
  'pop rock': 45, 'hard rock': 40, 'funk': 40, 'hip-hop': 55,
  'hip hop': 55, 'alternative rock': 40, 'progressive rock': 45,
  'post-punk': 50, 'grunge': 40, 'new wave': 55,
  'metal': 40, 'punk rock': 35, 'punk': 35,

  // Mostly electronic (60-80)
  'synthpop': 70, 'industrial': 75, 'industrial metal': 65,
  'trip-hop': 65, 'rap': 60, 'trap': 70, 'nu metal': 55,
  'drum and bass': 80, 'downtempo': 60, 'dream pop': 55,
  'noise rock': 50, 'shoegaze': 50,

  // Electronic (80-100)
  'electronic': 90, 'edm': 95, 'techno': 95, 'house': 90,
  'ambient': 75, 'chillout': 70, 'trance': 90, 'dubstep': 85,
  'hardstyle': 90, 'gabber': 95,
}
```

### Genre Tokenization

Parse `LocalReleaseTrack.genre` into individual terms:
```typescript
function tokenizeGenre(raw: string): string[] {
  return raw
    .split(/\s*[\/,]\s*/)      // split on / or , (with optional surrounding spaces)
    .map(g => g.trim().toLowerCase())
    .filter(Boolean)
}
```

**Important edge case**: `"Industrial/Electronic Metal"` should NOT split on bare `/` — only split on ` / ` (space-slash-space) or `, `. Refine regex:
```typescript
function tokenizeGenre(raw: string): string[] {
  return raw
    .split(/\s\/\s|,\s*/)    // split on " / " or ", "
    .map(g => g.trim().toLowerCase())
    .filter(Boolean)
}
```

When a track has multiple genre tokens, average their mapped values.

---

## API Endpoint

### `POST /api/tracks/explore`

**Request body:**
```typescript
interface ExploreRequest {
  energy: number     // 0-9
  era: number        // 0-9
  familiarity: number // 0-9
  sound: number      // 0-9
  excludeIds: string[] // track IDs to exclude (session history)
}
```

**Response:** Same shape as `/api/tracks/random` — a `PlayerTrack` object:
```typescript
interface PlayerTrack {
  id: string
  title: string
  artist: string
  album: string
  duration: number
  artistSlug: string | null
  releaseImage: string | null
  releaseImageUrl: string | null
  localReleaseId: string | null
}
```

### Query Strategy

1. **Pre-filter in SQL** to narrow candidates:
   - If `familiarity === 9`: WHERE `playCount = 0`
   - If `era` slider is set: WHERE `year` is within the target range +-10 years (soft filter) or year IS NULL
   - Exclude `excludeIds`
   - LIMIT 500 (random sample via `ORDER BY random()`)

2. **Fetch with metadata**: Select `id, title, artist, album, duration, year, genre, playCount, metadata, localReleaseId` + release image fields

3. **Score in JavaScript**: Apply the composite scoring algorithm

4. **Weighted random pick**: From top 15% of scored candidates

5. **Return PlayerTrack** shape

---

## Page Layout

### Route: `/explore`

### Structure (top to bottom):

```
┌──────────────────────────────────────────────┐
│  Page Title: "Explore"                       │
│  Subtitle: "Discover something new"          │
├──────────────────────────────────────────────┤
│                                              │
│  ┌─ I'm feeling... ───────────────────────┐  │
│  │  Tired  ●━━━━━━━━━━━━━━━━━━━  Powerful │  │
│  │            "Groovy"                    │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌─ Era ──────────────────────────────────┐  │
│  │  Classic ━━━━━━━●━━━━━━━━━━━━  Modern  │  │
│  │            "90s"                       │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌─ Discovery ────────────────────────────┐  │
│  │  Comfort Zone ━━━━━━━●━━━━━  Uncharted │  │
│  │            "Fresh"                     │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ┌─ Sound ────────────────────────────────┐  │
│  │  Acoustic  ━━━━━━━━━━━━━●━━  Electronic│  │
│  │            "Synthy"                    │  │
│  └────────────────────────────────────────┘  │
│                                              │
│          [ ▶  Explore ]  (big button)        │
│                                              │
├──────────────────────────────────────────────┤
│  Now Playing Card (appears after explore):   │
│  ┌────────────────────────────────────────┐  │
│  │  🎵 Cover  │ Title           │  🔄    │  │
│  │   Art      │ Artist          │ Again  │  │
│  │            │ Album • 2019    │        │  │
│  └────────────────────────────────────────┘  │
│                                              │
├──────────────────────────────────────────────┤
│  Session History:                            │
│  ┌────────────────────────────────────────┐  │
│  │  Title - Artist          3:42    ▶     │  │
│  │  Title - Artist          4:15    ▶     │  │
│  │  Title - Artist          2:58    ▶     │  │
│  └────────────────────────────────────────┘  │
└──────────────────────────────────────────────┘
```

### Now Playing Card

Shown after the first explore action. Displays:
- Release cover art (using `useImageUrl()` composable)
- Track title, artist, album name, year
- "Roll again" button (re-runs explore with same slider values, adds current track to excludeIds)
- Card uses `bg-zinc-900` with subtle border

### Session History

- Compact list below the card
- Shows: title, artist, duration
- Clickable to replay (sends track to player via `player.playTrack()`)
- Session-only (not persisted, clears on page leave)
- Most recent first

---

## Files to Create

| File | Purpose |
|---|---|
| `web/components/Slider.vue` | Reusable slider component |
| `web/pages/explore.vue` | Explore page |
| `web/server/api/tracks/explore.post.ts` | Explore API endpoint with scoring algorithm |
| `web/server/utils/explore.ts` | Genre maps, scoring functions, slider configs |

## Files to Modify

| File | Change |
|---|---|
| `web/components/layout/Sidebar.vue` | Add Explore nav item (Compass icon from lucide-vue-next) |
| `web/components/layout/MobileNav.vue` | Add Explore nav item (if mobile nav exists) |

---

## Slider Component Spec (`components/Slider.vue`)

### Props
```typescript
interface SliderProps {
  modelValue: number
  min?: number            // default 0
  max?: number            // default 9
  step?: number           // default 1
  leftLabel: string       // e.g. "Tired"
  rightLabel: string      // e.g. "Powerful"
  title: string           // e.g. "I'm feeling..."
  stops: string[]         // e.g. ["Sleepy", "Melancholic", ..., "Powerful"]
}
```

### Emits
- `update:modelValue` (number)

### Behavior
- Displays title above
- Left label and right label at the ends
- Current stop name displayed prominently (centered, above or below slider)
- Snaps to integer stops
- Uses `<input type="range">` with Tailwind styling
- `accent-amber-500` for the filled track
- Emits on `change` event (not `input`) to avoid excessive API calls during drag

### Visual Style
- Dark card background (`bg-zinc-900/50` or similar)
- Title in `text-zinc-400 text-sm font-medium`
- Current label in `text-zinc-50 text-lg font-semibold`
- Left/right labels in `text-zinc-500 text-xs`
- Slider track: zinc-700 background, amber-500 fill
- Thumb: amber-500

---

## Navigation

Add to Sidebar.vue between "Browse" and "Timeline":
```typescript
{ to: '/explore', label: 'Explore', icon: Compass }
```

Import `Compass` from `lucide-vue-next`.

---

## Edge Cases

1. **Very few matching tracks**: If the scored pool has < 5 tracks after filtering, relax constraints (widen BPM/era range, reduce minimum scores)
2. **All history excluded**: If `excludeIds` covers all candidates, return a random track with a flag indicating pool exhaustion
3. **No metadata at all**: Tracks with no BPM, no MOOD, and no genre get scored purely on era + familiarity (those two components have direct data)
4. **Negative MOOD_AROUSAL/VALENCE**: Clamp to 0 before scoring
5. **Missing year**: Neutral era score (0.5)
6. **Genre normalization**: Lowercase and trim before map lookup; if a genre token doesn't match the map, skip it (don't penalize)

---

## Performance Considerations

- The SQL pre-filter + LIMIT 500 + JS scoring approach keeps memory/CPU reasonable
- `ORDER BY random() LIMIT 500` on ~5K rows is fast (well under 50ms)
- JSONB extraction for 500 rows is lightweight
- No new indexes needed — existing primary key + the random sampling approach works fine
- Consider adding `CREATE INDEX idx_track_playcount ON "LocalReleaseTrack" ("playCount")` if familiarity filtering is slow

---

## Future Extensions (NOT in scope now)

- "Mood ring" visualization showing the track's mood profile
- Save slider presets
- Genre filter chips (narrow to specific genres)
- "More like this" button after playing a track
- Additional sliders: Instrumental↔Vocal, Short↔Long (duration), Decade-specific
