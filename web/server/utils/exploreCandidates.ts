import { Prisma } from '@prisma/client'
import type { TrackCandidate, ExploreParams } from '~/types/player'
import { prisma } from '~/server/utils/prisma'
import { ERA_CONFIGS, EXPLORE_METADATA_KEYS } from '~/server/utils/explore'
import { sampleIds } from '~/server/utils/randomSample'
import { trackPlaysByIds, withTrackPlay, recentSkipsByIds } from '~/server/utils/userPlays'

const POOL_SIZE = 500

interface CandidateRow {
  id: string
  title: string | null
  artist: string | null
  album: string | null
  duration: number | null
  year: number | null
  genre: string | null
  localReleaseId: string | null
  metadata: Record<string, unknown> | null
  image: string | null
  imageUrl: string | null
  artistSlug: string | null
}

// Only the scorer's tag keys leave the database (see EXPLORE_METADATA_KEYS).
const metadataProjection = Prisma.join(
  EXPLORE_METADATA_KEYS.map(key => Prisma.sql`${key}::text, t.metadata -> ${key}::text`),
)

const loadCandidates = async (ids: string[]): Promise<CandidateRow[]> =>
  prisma.$queryRaw<CandidateRow[]>`
    SELECT t.id, t.title, t.artist, t.album, t.duration, t.year, t.genre, t."localReleaseId",
           jsonb_strip_nulls(jsonb_build_object(${metadataProjection})) AS metadata,
           lr.image, lr."imageUrl",
           (SELECT a.slug FROM "LocalReleaseArtist" lra JOIN "Artist" a ON a.id = lra."artistId"
             WHERE lra."localReleaseId" = t."localReleaseId" ORDER BY lra."createdAt" LIMIT 1) AS "artistSlug"
    FROM "LocalReleaseTrack" t
    LEFT JOIN "LocalRelease" lr ON lr.id = t."localReleaseId"
    WHERE t.id = ANY(${ids}::text[])`


export interface ExplorePoolInput {
  userId: number
  params: ExploreParams
  excludeIds: string[]
}

// Builds Explore's candidate pool: a random sample of tracks across the whole library that satisfy the
// hard filters, with the tag keys the scorer needs and this user's play/skip history attached.
export const fetchExplorePool = async ({ userId, params, excludeIds }: ExplorePoolInput): Promise<TrackCandidate[]> => {
  // Soft era filter: the slider's range +-10 years, or tracks with no year at all.
  const [eraMin, eraMax] = ERA_CONFIGS[params.era]!
  const conditions: Prisma.Sql[] = [
    Prisma.sql`("LocalReleaseTrack".year BETWEEN ${eraMin - 10} AND ${eraMax + 10} OR "LocalReleaseTrack".year IS NULL)`,
  ]
  if (excludeIds.length > 0) {
    conditions.push(Prisma.sql`"LocalReleaseTrack".id NOT IN (${Prisma.join(excludeIds)})`)
  }
  // Hard filter for "Uncharted" familiarity: nothing this user has ever played.
  if (params.familiarity === 9) {
    conditions.push(Prisma.sql`NOT EXISTS (SELECT 1 FROM "LocalReleaseTrackPlay" p WHERE p."trackId" = "LocalReleaseTrack".id AND p."userId" = ${userId})`)
  }

  // Sampled across the whole library - a bare `findMany({ take: 500 })` returned the first 500 rows in heap
  // order, so Explore only ever drew from the same 500 tracks for a given era.
  const ids = await sampleIds(prisma, 'LocalReleaseTrack', POOL_SIZE, Prisma.join(conditions, ' AND '))
  if (ids.length === 0) {
    return []
  }

  const [raw, plays, recentSkips] = await Promise.all([
    loadCandidates(ids),
    trackPlaysByIds(userId, ids),
    recentSkipsByIds(userId, ids),
  ])

  return raw.map((row): TrackCandidate => ({
    ...withTrackPlay({
      id: row.id,
      title: row.title,
      artist: row.artist,
      album: row.album,
      duration: row.duration,
      year: row.year,
      genre: row.genre,
      metadata: row.metadata,
      localReleaseId: row.localReleaseId,
      localRelease: row.localReleaseId
        ? { image: row.image, imageUrl: row.imageUrl, artists: row.artistSlug ? [{ artist: { slug: row.artistSlug } }] : [] }
        : null,
    }, plays),
    recentSkips: recentSkips.get(row.id) ?? 0,
  }))
}
