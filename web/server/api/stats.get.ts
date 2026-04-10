import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=300, stale-while-revalidate=60')

  return cachedResponse('stats', 300, async () => {
    const stats = await prisma.statistics.findUnique({
      where: { id: 'main' },
    })

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
        lastScanStartedAt: null,
        lastScanEndedAt: null,
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
      lastScanStartedAt: stats.lastScanStartedAt?.toISOString() || null,
      lastScanEndedAt: stats.lastScanEndedAt?.toISOString() || null,
    }
  })
})
