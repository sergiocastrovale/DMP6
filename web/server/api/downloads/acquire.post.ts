import { requirePermission } from '~/server/utils/permissions'
import { prisma } from '~/server/utils/prisma'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { findBestSlskdResult, acquireRelease } from '~/server/utils/acquire'

// One-click auto-grab for a single MISSING release: search Soulseek, pick the best
// result and acquire it into the approval queue.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')

  const body = await readBody(event)
  const mbReleaseRowId = body?.mbReleaseRowId as string | undefined
  if (!mbReleaseRowId) throw createError({ statusCode: 400, message: 'mbReleaseRowId required' })

  const mb = await prisma.musicBrainzRelease.findUnique({
    where: { id: mbReleaseRowId },
    include: { artists: { include: { artist: true } } },
  })
  if (!mb) throw createError({ statusCode: 404, message: 'release not found' })

  // Already in flight / ready to merge / promoted? Don't double-grab.
  const existing = await prisma.downloadedRelease.findFirst({
    where: { mbReleaseId: mb.id, status: { in: ['DOWNLOADING', 'ENRICHING', 'READY', 'PROMOTED'] } },
    select: { id: true, status: true },
  })
  if (existing) return { id: existing.id, status: existing.status, alreadyQueued: true }

  const artist = mb.artists[0]?.artist
  if (!artist) throw createError({ statusCode: 409, message: 'release has no artist' })

  // Manual override: reuse a prior FAILED/ABANDONED row and reset the attempt cap (a human
  // deliberately forced this), so it isn't immediately re-abandoned.
  const prior = await prisma.downloadedRelease.findFirst({
    where: { mbReleaseId: mb.id, status: { in: ['FAILED', 'ABANDONED', 'REJECTED'] } },
    select: { id: true },
  })
  if (prior) await prisma.downloadedRelease.update({ where: { id: prior.id }, data: { attempts: 0 } })

  const settings = await resolveDownloadSettings()
  const best = await findBestSlskdResult(
    `${artist.name} ${mb.title}`.trim(),
    settings.downloadFormats || undefined,
    settings.downloadMinBitrate ?? undefined,
  )
  if (!best) {
    if (prior) await prisma.downloadedRelease.update({ where: { id: prior.id }, data: { status: 'FAILED', error: 'no Soulseek result found' } })
    return { id: null, status: 'NO_RESULT' as const }
  }

  const { id } = await acquireRelease({
    result: best,
    artistId: artist.id,
    artistName: artist.name,
    albumTitle: mb.title,
    year: mb.year ?? null,
    mbReleaseId: mb.id,
    releaseGroupId: mb.releaseGroupId ?? null,
  }, prior?.id)
  return { id, status: 'DOWNLOADING' as const }
})
