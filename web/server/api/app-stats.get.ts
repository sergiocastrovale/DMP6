import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'public, max-age=120, stale-while-revalidate=30')

  return cachedResponse('app-stats', 120, async () => {
    const stats = await prisma.statistics.findUnique({ where: { id: 'main' } })

    return {
      artists: stats?.mainArtists ?? 0,
      releases: stats?.releases ?? 0,
      tracks: stats?.tracks ?? 0,
      genres: stats?.genres ?? 0,
      playtime: Number(stats?.playtime ?? 0),
      totalFileSize: Number(stats?.totalFileSize ?? 0),
      totalPlays: Number(stats?.plays ?? 0),
    };
  });
});
