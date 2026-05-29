# Explore

4-slider music discovery at `/explore`. Scores tracks across energy, era, familiarity, and sound dimensions, then picks one via softmax temperature sampling.

## Sliders

| Slider | Range | Weight | Data Source |
|--------|-------|--------|-------------|
| Energy | Sleepy → Powerful | 40% | BPM + mood tags (`MOOD_AGGRESSIVE`, `MOOD_RELAXED`, etc.) → genre fallback |
| Era | 60s → Now | 20% | `year` field, linear decay over 30 years from target range |
| Familiarity | Comfort Zone → Uncharted | 20% | `playCount` weighted by `lastPlayedAt` recency |
| Sound | Acoustic → Electronic | 20% | `MOOD_ACOUSTIC` / `MOOD_ELECTRONIC` + `TIMBRE_BRIGHTNESS` → genre fallback |

## How Scoring Works

Each track gets a score from 0 to 1 per dimension, combined as a weighted sum.

**Energy** - BPM score (does BPM fall within the slider's target range?) and mood score (how close are the track's mood tags to the slider's target mood profile?) averaged at 50/50. When BPM or mood data is missing, falls back to genre-based estimation at reduced confidence.

**Era** - 1.0 if within the target decade/range, then linear decay to 0 at 30 years away. Tracks with no year get 0.5.

**Familiarity** - Play count normalized to 0-1 (capped at 20 plays), weighted by recency. Recent plays count at full weight; plays from a year ago count at ~50%. Slider 9 ("Uncharted") hard-filters to unplayed tracks only.

**Sound** - Distance between track's acoustic/electronic mood values and the slider's target. Timbre brightness used as a 15% secondary signal when available. Genre fallback at 0.75 confidence.

## Track Selection

1. Query ~500 random candidates from DB (pre-filtered by era ±10 years)
2. Score all candidates
3. Select via **softmax temperature sampling** (T=0.15) - higher-scoring tracks are exponentially more likely to be picked, but any candidate has a chance
4. Pool is cached for 5 minutes per slider combination to avoid re-querying on consecutive explores

## Metadata Coverage

Scoring quality depends on available file metadata:

| Data | Key(s) | Coverage |
|------|--------|----------|
| BPM | `IntegerBpm`, `BPM`, `Bpm`, `FBPM`, iTunes `fBPM` | ~96K tracks |
| Mood tags | `MOOD_HAPPY`, `MOOD_AGGRESSIVE`, `MOOD_RELAXED`, etc. | ~61K tracks |
| iTunes mood | `----:com.apple.iTunes:MOOD_*` variant | ~624 tracks |
| Timbre | `TIMBRE_BRIGHTNESS` | ~61K tracks |
| Genre | `genre` field (always available) | All tracks |

Both MP3 (`MOOD_*`) and iTunes (`----:com.apple.iTunes:MOOD_*`) key formats are handled automatically. Tracks without mood/BPM data fall back to genre-based estimation.

## Files

| File | Purpose |
|------|---------|
| `web/server/utils/explore.ts` | Scoring functions, genre maps, pool cache, softmax selection |
| `web/server/api/tracks/explore.post.ts` | API endpoint - fetches candidates, scores, returns pick |
| `web/composables/useExplorer.ts` | Client-side slider state, loading/error handling |
| `web/pages/explore.vue` | Page - sliders, explore button, current track card, session history |
| `web/components/explore/Card.vue` | Currently playing track display |
| `web/components/explore/History.vue` | Session history list |
| `web/stores/player.ts` | Explorer state (`explorerCurrentTrack`, `explorerSessionHistory`, shuffle mode) |

## Player Integration

- Pressing Explore sets shuffle mode to `explorer`
- `next()` in explorer mode auto-fetches the next scored track (no manual button press needed)
- Session history tracks are clickable to replay
- Toggling off explorer shuffle reverts to sequential playback within the current track's release
