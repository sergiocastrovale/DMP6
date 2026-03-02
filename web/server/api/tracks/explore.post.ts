import { prisma } from '~/server/utils/prisma'
import { scoreTrack, weightedRandomPick, type TrackCandidate, type ExploreParams } from '~/server/utils/explore'

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

  // Era year ranges for SQL pre-filter (±10 years for soft filter)
  const ERA_RANGES: [number, number][] = [
    [1960, 1969], [1970, 1979], [1980, 1989], [1990, 1999],
    [2000, 2004], [2005, 2009], [2010, 2014], [2015, 2019],
    [2020, 2024], [2025, 2030],
  ]
  const [eraMin, eraMax] = ERA_RANGES[params.era]

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
  const candidates = await prisma.localReleaseTrack.findMany({
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
      metadata: true,
      localReleaseId: true,
      localRelease: {
        select: {
          image: true,
          imageUrl: true,
          artist: { select: { slug: true } },
        },
      },
    },
    take: 500,
    // Prisma doesn't support ORDER BY random() directly,
    // so we'll shuffle in JS after fetching
  })

  if (candidates.length === 0) {
    throw createError({ statusCode: 404, message: 'No tracks found' })
  }

  // Shuffle candidates to randomize (since we can't do ORDER BY random() in Prisma)
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
  }

  // Take at most 500 after shuffle
  const pool = candidates.slice(0, 500)

  // Score each track
  const scored = pool.map(track => ({
    track: track as unknown as TrackCandidate,
    score: scoreTrack(track as unknown as TrackCandidate, params),
  }))

  // Weighted random pick from top scorers
  const pick = weightedRandomPick(scored)

  if (!pick) {
    throw createError({ statusCode: 404, message: 'No matching tracks found' })
  }

  const t = pick.track
  return {
    id: t.id,
    title: t.title || 'Unknown',
    artist: t.artist || 'Unknown',
    album: t.album || 'Unknown',
    duration: t.duration || 0,
    artistSlug: t.localRelease?.artist?.slug || null,
    releaseImage: t.localRelease?.image || null,
    releaseImageUrl: t.localRelease?.imageUrl || null,
    localReleaseId: t.localReleaseId,
  }
})
