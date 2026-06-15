import { requirePermission } from '~/server/utils/permissions'
import { prisma } from '~/server/utils/prisma'
import { computeDownloadPercent } from '~/server/utils/downloadProgress'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { resolveMonitorSettings } from '~/server/utils/monitorSettings'
import { getPauseState, freeGb } from '~/server/utils/pauseState'

// Returns the approval queue: active acquisitions (downloading / awaiting approval / failed)
// plus a slice of recent history (promoted / rejected).
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const [active, ready, history] = await Promise.all([
    prisma.downloadedRelease.findMany({
      where: { status: { in: ['DOWNLOADING', 'ENRICHING', 'PENDING', 'FAILED', 'ABANDONED'] } },
      include: { artist: { select: { name: true, slug: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.downloadedRelease.findMany({
      where: { status: 'APPROVED' }, // approved, in the approved folder, ready to merge
      include: { artist: { select: { name: true, slug: true } } },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.downloadedRelease.findMany({
      where: { status: { in: ['PROMOTED', 'REJECTED'] } },
      include: { artist: { select: { name: true, slug: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    }),
  ])

  // Resolve the MB release type per row for the info dialog (no FK relation -> batch lookup).
  const mbIds = [...new Set([...active, ...ready, ...history].map(r => r.mbReleaseId).filter(Boolean) as string[])]
  const mbReleases = mbIds.length
    ? await prisma.musicBrainzRelease.findMany({
        where: { id: { in: mbIds } },
        select: { id: true, type: { select: { name: true } } },
      })
    : []
  const typeById = new Map(mbReleases.map(m => [m.id, m.type?.name ?? null]))

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
    mbReleaseId: r.mbReleaseId,
    releaseGroupId: r.releaseGroupId,
    localReleaseId: r.localReleaseId,
    releaseType: r.mbReleaseId ? typeById.get(r.mbReleaseId) ?? null : null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ...computeDownloadPercent(r),
  })

  const { paused, reason } = await getPauseState()
  const { downloadsPath } = await resolveDownloadSettings()
  const { downloadsMinFreeGb } = await resolveMonitorSettings()
  const free = await freeGb(downloadsPath)

  return {
    active: active.map(shape),
    ready: ready.map(shape),
    history: history.map(shape),
    paused,
    pausedReason: reason,
    freeGb: free >= 0 ? Math.round(free * 10) / 10 : null,
    minFreeGb: downloadsMinFreeGb,
  }
})
