import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=120, stale-while-revalidate=30')

  return cachedResponse('app-stats', 120, async () => {
    const [stats, playlists, favorites, corrupted, unsplit, orphans, duplicates, missing, enrichment] = await Promise.all([
      prisma.statistics.findUnique({ where: { id: 'main' } }),
      prisma.playlist.count({ where: { type: 'MANUAL' } }),
      prisma.favoriteRelease.count(),
      prisma.issueCorruptedTpe2.count({ where: { status: 'DETECTED' } }),
      prisma.issueUnsplitArtist.count({ where: { status: 'DETECTED' } }),
      prisma.issueOrphanArtist.count({ where: { status: 'DETECTED' } }),
      prisma.issueDuplicateArtist.count({ where: { status: 'DETECTED' } }),
      prisma.issueMissingMetadata.count({ where: { status: 'DETECTED' } }),
      prisma.issueEnrichmentGap.count({ where: { status: 'DETECTED' } }),
    ])

    return {
      artists: stats?.mainArtists ?? 0,
      releases: stats?.releases ?? 0,
      tracks: stats?.tracks ?? 0,
      playtime: Number(stats?.playtime ?? 0),
      playlists,
      favorites,
      issues: corrupted + unsplit + orphans + duplicates + missing + enrichment,
    }
  })
})
