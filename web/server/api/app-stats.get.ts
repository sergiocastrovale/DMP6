import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=120, stale-while-revalidate=30')

  return cachedResponse('app-stats', 120, async () => {
    const [stats, playlists, favorites, issues] = await Promise.all([
      prisma.statistics.findUnique({ where: { id: 'main' } }),
      prisma.playlist.count(),
      prisma.favoriteRelease.count().then((r) => prisma.favoriteTrack.count().then((t) => r + t)),
      Promise.all([
        prisma.issueCorruptedTpe2.count({ where: { status: 'PENDING' } }),
        prisma.issueUnsplitArtist.count({ where: { status: 'PENDING' } }),
        prisma.issueOrphanArtist.count({ where: { status: 'PENDING' } }),
        prisma.issueDuplicateArtist.count({ where: { status: 'PENDING' } }),
        prisma.issueMissingMetadata.count({ where: { status: 'PENDING' } }),
        prisma.issueEnrichmentGap.count({ where: { status: 'PENDING' } }),
      ]).then((counts) => counts.reduce((a, b) => a + b, 0)),
    ])

    return {
      artists: stats?.mainArtists ?? 0,
      releases: stats?.releases ?? 0,
      tracks: stats?.tracks ?? 0,
      genres: stats?.genres ?? 0,
      playtime: Number(stats?.playtime ?? 0),
      totalFileSize: Number(stats?.totalFileSize ?? 0),
      totalPlays: Number(stats?.plays ?? 0),
      playlists,
      favorites,
      issues,
    }
  })
})
