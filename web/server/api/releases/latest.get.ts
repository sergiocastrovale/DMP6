import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { RELEASE_TILE_SELECT, toReleaseTile } from '~/server/utils/releaseTiles'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, max-age=60, stale-while-revalidate=30')

  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 50, 100)

  return cachedResponse(`releases:latest:${limit}`, 120, async () => {
    const releases = await prisma.localRelease.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: RELEASE_TILE_SELECT,
    })

    return releases.map(release => ({ ...toReleaseTile(release), createdAt: release.createdAt }))
  }, { shared: true })
})
