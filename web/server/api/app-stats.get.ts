import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { countActiveDownloads } from '~/server/utils/downloadQueue'
import { userTotalPlays } from '~/server/utils/userPlays'
import { countPendingIssues } from '~/server/utils/issueCounts'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, max-age=120, stale-while-revalidate=30')
  const userId = currentUserId(event)

  const [shared, playlists, favorites, totalPlays] = await Promise.all([
    cachedResponse('app-stats', 120, async () => {
      const [stats, issues, activeDownloads] = await Promise.all([
        prisma.statistics.findUnique({ where: { id: 'main' } }),
        countPendingIssues(),
        countActiveDownloads(),
      ])

      return {
        artists: stats?.mainArtists ?? 0,
        releases: stats?.releases ?? 0,
        tracks: stats?.tracks ?? 0,
        genres: stats?.genres ?? 0,
        playtime: Number(stats?.playtime ?? 0),
        totalFileSize: Number(stats?.totalFileSize ?? 0),
        issues,
        activeDownloads,
      }
    }, { shared: true }),
    // Sidebar "Playlists" count - the user's own MANUAL playlists only, not the shared GENRE/REGION
    // ones every user sees (visiblePlaylistsWhere would include those too). Per-user, so kept out of
    // the shared cache above (its Redis entry is process-wide, not per caller).
    prisma.playlist.count({ where: { userId } }),
    prisma.favoriteRelease.count({ where: { userId } }).then((r) => prisma.favoriteTrack.count({ where: { userId } }).then((t) => r + t)),
    userTotalPlays(userId),
  ])

  return { ...shared, playlists, favorites, totalPlays }
})
