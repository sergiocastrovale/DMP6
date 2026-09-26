import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { RELEASE_TILE_SELECT, toReleaseTile } from '~/server/utils/releaseTiles'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, max-age=60, stale-while-revalidate=30')

  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 50, 100)

  return cachedResponse(`releases:updated:${limit}`, 120, async () => {
    const releases = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "LocalRelease"
      WHERE "updatedAt" > "createdAt"
      ORDER BY "updatedAt" DESC
      LIMIT ${limit}
    `

    const rows = await prisma.localRelease.findMany({
      where: { id: { in: releases.map(r => r.id) } },
      select: RELEASE_TILE_SELECT,
    })

    const order = new Map(releases.map((r, i) => [r.id, i]))
    rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!)

    return rows.map(release => ({ ...toReleaseTile(release), updatedAt: release.updatedAt }))
  }, { shared: true })
})
