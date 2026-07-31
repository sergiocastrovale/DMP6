import { prisma } from '~/server/utils/prisma'

// Cap each visible bucket independently (rather than one flat LIMIT over the combined "active"
// where-clause) so a large FAILED/UNAVAILABLE backlog can't silently crowd DOWNLOADING/ENRICHING (or
// each other) out of the /downloads queue response — every tab still gets up to ACTIVE_TAKE items of
// its own kind.
export const ACTIVE_TAKE = 200

const artistSelect = { artist: { select: { name: true, slug: true } } } as const

/**
 * The "active" slice of the download queue (Downloading/Enriching, Failed/Abandoned, Unavailable
 * tabs), each bucket queried and capped separately so none of them can starve the others out of the
 * response. Newest first within each bucket.
 */
export async function fetchActiveQueueRows() {
  const [inFlight, failed, unavailable] = await Promise.all([
    prisma.downloadedRelease.findMany({
      where: { status: { in: ['DOWNLOADING', 'ENRICHING'] } },
      include: artistSelect,
      orderBy: { createdAt: 'desc' },
      take: ACTIVE_TAKE,
    }),
    prisma.downloadedRelease.findMany({
      where: { status: { in: ['FAILED', 'ABANDONED'] } },
      include: artistSelect,
      orderBy: { createdAt: 'desc' },
      take: ACTIVE_TAKE,
    }),
    prisma.downloadedRelease.findMany({
      where: { status: 'UNAVAILABLE' },
      include: artistSelect,
      orderBy: { createdAt: 'desc' },
      take: ACTIVE_TAKE,
    }),
  ])
  return [...inFlight, ...failed, ...unavailable]
}

/** The dedicated "Rejected" tab bucket — terminal, force-rejected rows, newest first, capped. */
export async function fetchRejectedQueueRows() {
  return prisma.downloadedRelease.findMany({
    where: { status: 'REJECTED' },
    include: artistSelect,
    orderBy: { updatedAt: 'desc' },
    take: ACTIVE_TAKE,
  })
}
