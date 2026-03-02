// Genre → Energy score (0-100). Used as fallback when BPM/mood tags are missing.
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

// Genre → Acoustic score (0=acoustic, 100=electronic)
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

// Energy slider configs: [bpmMin, bpmMax, moodTargets]
// Mood targets: { dimension: targetValue (0-99) }
interface EnergyConfig {
  bpmMin: number
  bpmMax: number
  moods: Partial<Record<string, number>>
}

const ENERGY_CONFIGS: EnergyConfig[] = [
  // 0: Sleepy
  { bpmMin: 60, bpmMax: 85, moods: { MOOD_RELAXED: 90, MOOD_SAD: 30, MOOD_HAPPY: 10, MOOD_AGGRESSIVE: 0, MOOD_PARTY: 0 } },
  // 1: Melancholic
  { bpmMin: 65, bpmMax: 95, moods: { MOOD_SAD: 80, MOOD_RELAXED: 50, MOOD_HAPPY: 5, MOOD_AGGRESSIVE: 5, MOOD_PARTY: 0 } },
  // 2: Calm
  { bpmMin: 70, bpmMax: 100, moods: { MOOD_RELAXED: 85, MOOD_HAPPY: 30, MOOD_AGGRESSIVE: 0, MOOD_PARTY: 5 } },
  // 3: Reflective
  { bpmMin: 80, bpmMax: 115, moods: { MOOD_RELAXED: 60, MOOD_VALENCE: 30, MOOD_AGGRESSIVE: 5, MOOD_PARTY: 10 } },
  // 4: Chill
  { bpmMin: 85, bpmMax: 120, moods: { MOOD_RELAXED: 50, MOOD_HAPPY: 50, MOOD_DANCEABILITY: 40, MOOD_AGGRESSIVE: 5 } },
  // 5: Groovy
  { bpmMin: 95, bpmMax: 130, moods: { MOOD_DANCEABILITY: 70, MOOD_PARTY: 60, MOOD_HAPPY: 65, MOOD_SAD: 5 } },
  // 6: Upbeat
  { bpmMin: 110, bpmMax: 145, moods: { MOOD_HAPPY: 80, MOOD_PARTY: 75, MOOD_DANCEABILITY: 80, MOOD_SAD: 0 } },
  // 7: Energetic
  { bpmMin: 120, bpmMax: 160, moods: { MOOD_PARTY: 85, MOOD_AROUSAL: 85, MOOD_DANCEABILITY: 85, MOOD_RELAXED: 5 } },
  // 8: Fierce
  { bpmMin: 135, bpmMax: 180, moods: { MOOD_AGGRESSIVE: 90, MOOD_AROUSAL: 90, MOOD_HAPPY: 60, MOOD_RELAXED: 0 } },
  // 9: Powerful
  { bpmMin: 145, bpmMax: 200, moods: { MOOD_AGGRESSIVE: 95, MOOD_AROUSAL: 95, MOOD_PARTY: 70, MOOD_RELAXED: 0 } },
]

// Era slider configs: [yearMin, yearMax]
const ERA_CONFIGS: [number, number][] = [
  [1960, 1969], // 0: 60s
  [1970, 1979], // 1: 70s
  [1980, 1989], // 2: 80s
  [1990, 1999], // 3: 90s
  [2000, 2004], // 4: Y2K
  [2005, 2009], // 5: Late 2000s
  [2010, 2014], // 6: Early 2010s
  [2015, 2019], // 7: Late 2010s
  [2020, 2024], // 8: 2020s
  [2025, 2030], // 9: Now
]

// Sound slider configs: [targetAcoustic, targetElectronic]
const SOUND_CONFIGS: [number, number][] = [
  [90, 5],   // 0: Acoustic
  [80, 10],  // 1: Unplugged
  [70, 20],  // 2: Natural
  [55, 35],  // 3: Warm
  [45, 45],  // 4: Balanced
  [35, 55],  // 5: Hybrid
  [25, 65],  // 6: Produced
  [15, 78],  // 7: Synthy
  [8, 88],   // 8: Digital
  [5, 95],   // 9: Electronic
]

// Split raw genre tag into individual genre terms
function tokenizeGenre(raw: string): string[] {
  return raw
    .split(/\s\/\s|,\s*/)
    .map(g => g.trim().toLowerCase())
    .filter(Boolean)
}

// Look up a genre map value, trying exact match then substring/partial matches
function lookupGenre(tokens: string[], map: Record<string, number>): number | null {
  const scores: number[] = []
  for (const token of tokens) {
    if (map[token] !== undefined) {
      scores.push(map[token])
      continue
    }
    // Try partial: find the longest map key that is a substring of the token
    let best: { key: string; score: number } | null = null
    for (const [key, score] of Object.entries(map)) {
      if (token.includes(key) && (!best || key.length > best.key.length)) {
        best = { key, score }
      }
    }
    if (best) scores.push(best.score)
  }
  return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null
}

// Clamp a metadata value to 0-99
function clampMood(val: unknown): number {
  const n = typeof val === 'string' ? parseInt(val, 10) : typeof val === 'number' ? val : 0
  return Math.max(0, Math.min(99, isNaN(n) ? 0 : n))
}

export interface TrackCandidate {
  id: string
  title: string | null
  artist: string | null
  album: string | null
  duration: number | null
  year: number | null
  genre: string | null
  playCount: number
  metadata: Record<string, unknown> | null
  localReleaseId: string | null
  localRelease: {
    image: string | null
    imageUrl: string | null
    artist: { slug: string } | null
  } | null
}

export interface ExploreParams {
  energy: number
  era: number
  familiarity: number
  sound: number
}

interface ScoredTrack {
  track: TrackCandidate
  score: number
}

export function scoreTrack(track: TrackCandidate, params: ExploreParams): number {
  const meta = track.metadata as Record<string, string | number> | null
  const genreTokens = track.genre ? tokenizeGenre(track.genre) : []

  const energyScore = scoreEnergy(meta, genreTokens, params.energy)
  const eraScore = scoreEra(track.year, params.era)
  const familiarityScore = scoreFamiliarity(track.playCount, params.familiarity)
  const soundScore = scoreSound(meta, genreTokens, params.sound)

  return (energyScore * 0.40) + (eraScore * 0.20) + (familiarityScore * 0.20) + (soundScore * 0.20)
}

function scoreEnergy(meta: Record<string, string | number> | null, genreTokens: string[], slider: number): number {
  const config = ENERGY_CONFIGS[slider]
  const hasBpm = meta && meta['IntegerBpm'] !== undefined
  const hasMood = meta && meta['MOOD_HAPPY'] !== undefined

  let bpmScore: number
  let bpmConfidence = 1.0

  if (hasBpm) {
    const bpm = typeof meta!['IntegerBpm'] === 'string' ? parseInt(meta!['IntegerBpm'] as string, 10) : meta!['IntegerBpm'] as number
    if (bpm >= config.bpmMin && bpm <= config.bpmMax) {
      bpmScore = 1.0
    } else {
      const nearestEdge = bpm < config.bpmMin ? config.bpmMin : config.bpmMax
      const dist = Math.abs(bpm - nearestEdge)
      if (dist <= 15) bpmScore = 0.5
      else bpmScore = Math.max(0, 1 - dist / 50)
    }
  } else {
    // Genre fallback for BPM
    const genreEnergy = lookupGenre(genreTokens, GENRE_ENERGY_MAP)
    if (genreEnergy !== null) {
      // Map genre energy (0-100) to how well it fits this slider's expected energy range
      const sliderEnergy = (slider / 9) * 100
      const dist = Math.abs(genreEnergy - sliderEnergy)
      bpmScore = Math.max(0, 1 - dist / 60)
      bpmConfidence = 0.75
    } else {
      bpmScore = 0.5
      bpmConfidence = 0.5
    }
  }

  let moodScore: number
  let moodConfidence = 1.0

  if (hasMood) {
    const dims: number[] = []
    for (const [key, target] of Object.entries(config.moods)) {
      const trackVal = clampMood(meta![key])
      dims.push(1 - Math.abs(trackVal - target!) / 100)
    }
    moodScore = dims.length > 0 ? dims.reduce((a, b) => a + b, 0) / dims.length : 0.5
  } else {
    // Genre fallback for mood
    const genreEnergy = lookupGenre(genreTokens, GENRE_ENERGY_MAP)
    if (genreEnergy !== null) {
      const sliderEnergy = (slider / 9) * 100
      const dist = Math.abs(genreEnergy - sliderEnergy)
      moodScore = Math.max(0, 1 - dist / 60)
      moodConfidence = 0.75
    } else {
      moodScore = 0.5
      moodConfidence = 0.5
    }
  }

  const confidence = (bpmConfidence + moodConfidence) / 2
  return (bpmScore * 0.5 + moodScore * 0.5) * confidence
}

function scoreEra(year: number | null, slider: number): number {
  if (year === null) return 0.5

  const [targetMin, targetMax] = ERA_CONFIGS[slider]

  if (year >= targetMin && year <= targetMax) return 1.0

  const distMin = Math.abs(year - targetMin)
  const distMax = Math.abs(year - targetMax)
  const dist = Math.min(distMin, distMax)

  if (dist <= 5) return 0.6
  if (dist <= 10) return 0.3
  return 0.0
}

function scoreFamiliarity(playCount: number, slider: number): number {
  if (slider === 9 && playCount > 0) return 0

  const normalizedPlays = Math.min(playCount / 20, 1.0)
  const targetFamiliarity = slider / 9 // 0 = familiar, 1 = uncharted
  const distance = Math.abs(targetFamiliarity - (1 - normalizedPlays))
  return 1 - distance
}

function scoreSound(meta: Record<string, string | number> | null, genreTokens: string[], slider: number): number {
  const [targetAcoustic, targetElectronic] = SOUND_CONFIGS[slider]
  const hasMood = meta && meta['MOOD_ACOUSTIC'] !== undefined

  if (hasMood) {
    const trackAcoustic = clampMood(meta!['MOOD_ACOUSTIC'])
    const trackElectronic = clampMood(meta!['MOOD_ELECTRONIC'])
    const acousticDist = Math.abs(trackAcoustic - targetAcoustic) / 100
    const electronicDist = Math.abs(trackElectronic - targetElectronic) / 100
    return 1 - (acousticDist + electronicDist) / 2
  }

  // Genre fallback
  const genreAcoustic = lookupGenre(genreTokens, GENRE_ACOUSTIC_MAP)
  if (genreAcoustic !== null) {
    // genreAcoustic is 0-100 where 0=acoustic, 100=electronic
    // targetAcoustic is 0-99, targetElectronic is 0-99
    const sliderElectronic = (slider / 9) * 100
    const dist = Math.abs(genreAcoustic - sliderElectronic)
    return Math.max(0, 1 - dist / 60) * 0.75
  }

  return 0.5 * 0.5
}

export function weightedRandomPick(scored: ScoredTrack[]): ScoredTrack | null {
  if (scored.length === 0) return null

  // Take top 15% (minimum 20)
  const poolSize = Math.max(20, Math.ceil(scored.length * 0.15))
  const pool = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, poolSize)

  // Weighted random: probability proportional to score^2
  const weights = pool.map(t => t.score * t.score)
  const totalWeight = weights.reduce((a, b) => a + b, 0)

  if (totalWeight === 0) {
    // All scores zero — pick random from pool
    return pool[Math.floor(Math.random() * pool.length)]
  }

  let r = Math.random() * totalWeight
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]
    if (r <= 0) return pool[i]
  }

  return pool[pool.length - 1]
}
