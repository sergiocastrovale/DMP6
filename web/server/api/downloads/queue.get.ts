import { requirePermission } from '~/server/utils/permissions'
import { prisma } from '~/server/utils/prisma'
import { computeDownloadPercent } from '~/server/utils/downloadProgress'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { resolveMonitorSettings } from '~/server/utils/monitorSettings'
import { getPauseState, freeGb } from '~/server/utils/pauseState'
import { getAcquisitionStatus } from '~/server/utils/downloadSources'
import { fetchActiveQueueRows, fetchRejectedQueueRows, fetchHistoryQueueRows } from '~/server/utils/downloadQueue'

const artistSelect = { artist: { select: { name: true, slug: true } } } as const

// Returns the download queue: active acquisitions (downloading / enriching / failed / abandoned) plus
// the ready slice, the dedicated rejected slice, and a slice of recent history (promoted / invalid, for
// the History subtabs — REJECTED lives in its own tab/bucket, and ABANDONED stays in "active"/Failed
// since it's still retryable, not history; see downloadQueue.ts's fetchHistoryQueueRows).
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const [active, ready, rejected, history] = await Promise.all([
    fetchActiveQueueRows(),
    prisma.downloadedRelease.findMany({
      where: { status: 'READY' }, // in the ready folder, awaiting manual merge
      include: artistSelect,
      orderBy: { updatedAt: 'desc' },
    }),
    fetchRejectedQueueRows(),
    fetchHistoryQueueRows(),
  ])

  // Resolve the MB release type per row for the info dialog (no FK relation -> batch lookup).
  const mbIds = [...new Set([...active, ...ready, ...rejected, ...history].map(r => r.mbReleaseId).filter(Boolean) as string[])]
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
    torrentHash: r.torrentHash,
    quality: r.quality,
    status: r.status,
    attempts: r.attempts,
    priority: r.priority,
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
  const acquisition = await getAcquisitionStatus()

  return {
    active: active.map(shape),
    ready: ready.map(shape),
    rejected: rejected.map(shape),
    history: history.map(shape),
    paused,
    pausedReason: reason,
    freeGb: free >= 0 ? Math.round(free * 10) / 10 : null,
    minFreeGb: downloadsMinFreeGb,
    acquisition,
  }
})
