import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import {
  scoreTrack, weightedRandomPick,
  getPoolCacheKey, getCachedPool, setCachedPool, removeFromPool,
  type TrackCandidate, type ExploreParams,
} from '~/server/utils/explore'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    energy?: number
    era?: number
    familiarity?: number
    sound?: number
    excludeIds?: string[]
  }>(event)

  const params: ExploreParams = {
    energy: Math.min(9, Math.max(0, Math.round(body.energy ?? 5))),
    era: Math.min(9, Math.max(0, Math.round(body.era ?? 5))),
    familiarity: Math.min(9, Math.max(0, Math.round(body.familiarity ?? 4))),
    sound: Math.min(9, Math.max(0, Math.round(body.sound ?? 4))),
  }

  const excludeIds = Array.isArray(body.excludeIds) ? body.excludeIds : []
  const cacheKey = getPoolCacheKey(params)

  // Try cached pool first
  let candidates: TrackCandidate[]
  const cached = getCachedPool(cacheKey, excludeIds)

  if (cached && cached.length >= 20) {
    candidates = cached
  } else {
    // Era year ranges for SQL pre-filter (±10 years for soft filter)
    const ERA_RANGES: [number, number][] = [
      [1960, 1969], [1970, 1979], [1980, 1989], [1990, 1999],
      [2000, 2004], [2005, 2009], [2010, 2014], [2015, 2019],
      [2020, 2024], [2025, 2030],
    ]
    const [eraMin, eraMax] = ERA_RANGES[params.era]!

    // Build where clause for SQL pre-filtering
    const where: Record<string, unknown> = {}

    if (excludeIds.length > 0) {
      where.id = { notIn: excludeIds }
    }

    // Hard filter for "Uncharted" familiarity
    if (params.familiarity === 9) {
      where.playCount = 0
    }

    // Soft era filter: include tracks in range ±10 years OR tracks with no year
    where.OR = [
      { year: { gte: eraMin - 10, lte: eraMax + 10 } },
      { year: null },
    ]

    // Fetch a random sample of candidates with metadata
    const raw = await prisma.localReleaseTrack.findMany({
      where,
      select: {
        id: true,
        title: true,
        artist: true,
        album: true,
        duration: true,
        year: true,
        genre: true,
        playCount: true,
        lastPlayedAt: true,
        metadata: true,
        localReleaseId: true,
        localRelease: {
          select: {
            image: true,
            imageUrl: true,
            artists: { select: { artist: { select: { slug: true } } } },
          },
        },
      },
      take: 500,
    })

    if (raw.length === 0) {
      throw createError({ statusCode: 404, message: 'No tracks found' })
    }

    // Shuffle candidates
    for (let i = raw.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[raw[i], raw[j]] = [raw[j]!, raw[i]!]
    }

    candidates = raw.slice(0, 500) as unknown as TrackCandidate[]

    // Cache the full pool for subsequent requests with the same params
    setCachedPool(cacheKey, candidates)
  }

  // Score each track
  const scored = candidates.map(track => ({
    track,
    score: scoreTrack(track, params),
  }))

  // Weighted random pick from top scorers
  const pick = weightedRandomPick(scored)

  if (!pick) {
    throw createError({ statusCode: 404, message: 'No matching tracks found' })
  }

  // Remove picked track from cache so it won't repeat
  removeFromPool(cacheKey, pick.track.id)

  const t = pick.track
  const img = verifyImage(t.localRelease?.image, t.localRelease?.imageUrl, 'releases')
  return {
    id: t.id,
    title: t.title || 'Unknown',
    artist: t.artist || 'Unknown',
    album: t.album || 'Unknown',
    duration: t.duration || 0,
    // Already selected above for the era filter; the explore history row shows it under the title.
    year: t.year ?? null,
    artistSlug: (t.localRelease as any)?.artists?.[0]?.artist?.slug || null,
    releaseImage: img.image,
    releaseImageUrl: img.imageUrl,
    localReleaseId: t.localReleaseId,
  }
})
