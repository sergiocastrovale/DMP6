import { requirePermission } from '~/server/utils/permissions'
import { prisma } from '~/server/utils/prisma'
import { computeDownloadPercent } from '~/server/utils/downloadProgress'

// Returns the approval queue: active acquisitions (downloading / awaiting approval / failed)
// plus a slice of recent history (promoted / rejected).
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const [active, history] = await Promise.all([
    prisma.downloadedRelease.findMany({
      where: { status: { in: ['DOWNLOADING', 'ENRICHING', 'PENDING', 'FAILED', 'ABANDONED'] } },
      include: { artist: { select: { name: true, slug: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.downloadedRelease.findMany({
      where: { status: { in: ['PROMOTED', 'REJECTED'] } },
      include: { artist: { select: { name: true, slug: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    }),
  ])

  const shape = (r: typeof active[number]) => ({
    id: r.id,
    artist: r.artist?.name ?? null,
    artistSlug: r.artist?.slug ?? null,
    title: r.title,
    year: r.year,
    source: r.source,
    slskUsername: r.slskUsername,
    quality: r.quality,
    status: r.status,
    attempts: r.attempts,
    error: r.error,
    stagingPath: r.stagingPath,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ...computeDownloadPercent(r),
  })

  return { active: active.map(shape), history: history.map(shape) }
})
