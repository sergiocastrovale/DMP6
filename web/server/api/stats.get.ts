import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async () => {
  const stats = await prisma.statistics.findUnique({
    where: { id: 'main' },
  })

  if (!stats) {
    // Return zeros if no stats record exists yet
    return {
      artists: 0,
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
