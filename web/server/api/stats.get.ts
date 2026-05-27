import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=60')

  return cachedResponse('stats', 300, async () => {
    const [stats, unmatchedReleases, incompleteReleases, lowBitrateTracks, singleReleaseResult, missingArtReleases] = await Promise.all([
      prisma.statistics.findUnique({ where: { id: 'main' } }),
      prisma.localRelease.count({ where: { matchStatus: 'UNMATCHED' } }),
      prisma.localRelease.count({ where: { matchStatus: { in: ['INCOMPLETE', 'MISSING_TRACKS'] } } }),
      prisma.localReleaseTrack.count({ where: { bitrate: { lt: 256, gt: 0 } } }),
      prisma.$queryRawUnsafe<[{ count: bigint }]>(`
        SELECT COUNT(*)::bigint AS count FROM (
          SELECT lra."artistId"
          FROM "LocalReleaseArtist" lra
          JOIN "Artist" a ON a.id = lra."artistId"
          WHERE a."relatedOnly" = false
          GROUP BY lra."artistId"
          HAVING COUNT(DISTINCT lra."localReleaseId") = 1
        ) sub
      `),
      prisma.localRelease.count({ where: { image: null, imageUrl: null } }),
    ])

    const curation = {
      unmatchedReleases,
      incompleteReleases,
      lowBitrateTracks,
      singleReleaseArtists: Number(singleReleaseResult[0].count),
      missingArtReleases,
    }

    if (!stats) {
      return {
        artists: 0,
        mainArtists: 0,
        relatedArtists: 0,
        tracks: 0,
        releases: 0,
        genres: 0,
        playtime: 0,
        plays: 0,
        artistsSyncedWithMusicbrainz: 0,
        releasesSyncedWithMusicbrainz: 0,
        artistsWithCoverArt: 0,
        releasesWithCoverArt: 0,
        totalFileSize: 0,
        lastScanStartedAt: null,
        lastScanEndedAt: null,
        ...curation,
      }
    }

    return {
      artists: stats.artists,
      mainArtists: stats.mainArtists,
      relatedArtists: stats.relatedArtists,
      tracks: stats.tracks,
      releases: stats.releases,
      genres: stats.genres,
      playtime: Number(stats.playtime),
      plays: Number(stats.plays),
      artistsSyncedWithMusicbrainz: stats.artistsSyncedWithMusicbrainz,
      releasesSyncedWithMusicbrainz: stats.releasesSyncedWithMusicbrainz,
      artistsWithCoverArt: stats.artistsWithCoverArt,
      releasesWithCoverArt: stats.releasesWithCoverArt,
      totalFileSize: Number(stats.totalFileSize),
      lastScanStartedAt: stats.lastScanStartedAt?.toISOString() || null,
      lastScanEndedAt: stats.lastScanEndedAt?.toISOString() || null,
      ...curation,
    }
  })
})
