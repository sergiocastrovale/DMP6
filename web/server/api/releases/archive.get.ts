import { prisma } from '~/server/utils/prisma'
import { RELEASE_TILE_SELECT, toReleaseTile } from '~/server/utils/releaseTiles'
import { randomArchivedReleaseIds } from '~/server/utils/releaseArchive'
import { currentUserId } from '~/server/utils/libraryOwnership'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, max-age=300, stale-while-revalidate=60')
  const userId = currentUserId(event)

  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 8, 50)

  // "Archived" is per-user (nothing played in two years), decided by the database and sampled at random - the
  // response is a fresh draw each time rather than a 5-minute-cached pool of the newest 50 (audit #86).
  const ids = await randomArchivedReleaseIds(prisma, userId, limit)
  if (ids.length === 0) {return []}

  const rows = await prisma.localRelease.findMany({ where: { id: { in: ids } }, select: RELEASE_TILE_SELECT })
  const byId = new Map(rows.map(r => [r.id, r]))
  return ids.flatMap(id => byId.get(id) ?? []).map(toReleaseTile)
})
