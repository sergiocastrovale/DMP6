import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { releaseTypeBucketSql } from '~/server/utils/releaseTypeBuckets'
import { releaseTypeBuckets } from '~/helpers/constants'
import type { ReleaseTypeBucketId } from '~/types/stats'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { userTotalPlays, recentPlayCounts } from '~/server/utils/userPlays'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, max-age=300, stale-while-revalidate=60')
  const userId = currentUserId(event)

  const shared = await cachedResponse('stats', 300, async () => {
    const [stats, unmatchedReleases, incompleteReleases, lowBitrateTracks, singleReleaseResult, missingArtReleases, linkedArtists, releaseTypeRows] = await Promise.all([
      prisma.statistics.findUnique({ where: { id: 'main' } }),
      prisma.localRelease.count({ where: { matchStatus: 'UNMATCHED' } }),
      prisma.localRelease.count({ where: { matchStatus: { in: ['INCOMPLETE', 'MISSING_TRACKS'] } } }),
      prisma.localReleaseTrack.count({ where: { bitrate: { lt: 256, gt: 0 } } }),
      prisma.$queryRawUnsafe<[{ count: bigint }]>(`
        SELECT COUNT(*)::bigint AS count FROM (
          SELECT lra."artistId"
          FROM "LocalReleaseArtist" lra
          JOIN "Artist" a ON a.id = lra."artistId"
          WHERE a."primaryArtistId" IS NULL
          GROUP BY lra."artistId"
          HAVING COUNT(DISTINCT lra."localReleaseId") = 1
        ) sub
      `),
      prisma.localRelease.count({ where: { image: null, imageUrl: null } }),
      prisma.artist.count({ where: { primaryArtistId: { not: null } } }),
      prisma.$queryRawUnsafe<{ bucket: ReleaseTypeBucketId, count: bigint }[]>(`
        SELECT ${releaseTypeBucketSql} AS bucket, COUNT(*)::bigint AS count
        FROM "LocalRelease" lr
        LEFT JOIN "MusicBrainzRelease" mb ON mb.id = lr."releaseId"
        LEFT JOIN "ReleaseType" rt ON rt.id = mb."typeId"
        GROUP BY 1
      `),
    ])

    const releaseTypes = Object.fromEntries(releaseTypeBuckets.map(b => [b.id, 0])) as Record<ReleaseTypeBucketId, number>
    for (const row of releaseTypeRows) { releaseTypes[row.bucket] = Number(row.count) }

    const curation = {
      unmatchedReleases,
      incompleteReleases,
      lowBitrateTracks,
      singleReleaseArtists: Number(singleReleaseResult[0].count),
      missingArtReleases,
      linkedArtists,
      releaseTypes,
    }

    if (!stats) {
      return {
        artists: 0,
        mainArtists: 0,
        tracks: 0,
        releases: 0,
        genres: 0,
        playtime: 0,
        artistsSyncedWithMusicbrainz: 0,
        releasesSyncedWithMusicbrainz: 0,
        artistsWithCoverArt: 0,
        releasesWithCoverArt: 0,
        totalFileSize: 0,
        lastScanStartedAt: null,
        lastScanEndedAt: null,
        ...curation,
        linkedArtists: 0,
      }
    }

    return {
      artists: stats.artists,
      mainArtists: stats.mainArtists,
      tracks: stats.tracks,
      releases: stats.releases,
      genres: stats.genres,
      playtime: Number(stats.playtime),
      artistsSyncedWithMusicbrainz: stats.artistsSyncedWithMusicbrainz,
      releasesSyncedWithMusicbrainz: stats.releasesSyncedWithMusicbrainz,
      artistsWithCoverArt: stats.artistsWithCoverArt,
      releasesWithCoverArt: stats.releasesWithCoverArt,
      totalFileSize: Number(stats.totalFileSize),
      lastScanStartedAt: stats.lastScanStartedAt?.toISOString() || null,
      lastScanEndedAt: stats.lastScanEndedAt?.toISOString() || null,
      ...curation,
    }
  }, { shared: true })

  // Per-user, so kept out of the shared cache above (its Redis entry is process-wide, not per caller).
  const [plays, recentPlays] = await Promise.all([userTotalPlays(userId), recentPlayCounts(userId)])
  return { ...shared, plays, recentPlays }
})
