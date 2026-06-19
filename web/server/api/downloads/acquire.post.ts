import { Prisma } from '@prisma/client'
import { requirePermission } from '~/server/utils/permissions'
import { prisma } from '~/server/utils/prisma'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { getDownloadSources, chooseSource, rtBudgetAvailable } from '~/server/utils/downloadSources'
import { routeAcquire, failRtMiss } from '~/server/utils/autoDownload'

// One-click manual grab for a single MISSING release. Routes through the same source picker as the
// monitor: RuTracker first (while it has daily budget), Soulseek fallback — honoring the enabled
// sources, so it works whichever source(s) the user has switched on.
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

  // No MusicBrainz year = erroneous release (can't lay it out as `YYYY - title`). Discard it: record a
  // FAILED row (reusing any prior one) so it shows in the Failed list, and never grab it.
  if (mb.year == null) {
    const errored = await prisma.downloadedRelease.findFirst({ where: { mbReleaseId: mb.id }, select: { id: true } })
    const data = { status: 'FAILED' as const, error: 'no MusicBrainz year — erroneous release', stagingPath: null }
    const row = errored
      ? await prisma.downloadedRelease.update({ where: { id: errored.id }, data })
      : await prisma.downloadedRelease.create({
        data: { ...data, artistId: mb.artists[0]?.artist?.id ?? '', mbReleaseId: mb.id, releaseGroupId: mb.releaseGroupId ?? null, title: mb.title, year: null },
      }).catch(() => null)
    return { id: row?.id ?? null, status: 'NO_YEAR' as const }
  }

  // Already in flight / ready to merge / promoted? Don't double-grab.
  const existing = await prisma.downloadedRelease.findFirst({
    where: { mbReleaseId: mb.id, status: { in: ['DOWNLOADING', 'ENRICHING', 'READY', 'PROMOTED'] } },
    select: { id: true, status: true },
  })
  if (existing) return { id: existing.id, status: existing.status, alreadyQueued: true }

  const artist = mb.artists[0]?.artist
  if (!artist) throw createError({ statusCode: 409, message: 'release has no artist' })

  // Manual override: reuse a prior FAILED/ABANDONED/UNAVAILABLE/INVALID row and reset the attempt cap
  // (a human deliberately forced this) so it isn't immediately re-abandoned.
  const prior = await prisma.downloadedRelease.findFirst({
    where: { mbReleaseId: mb.id, status: { in: ['FAILED', 'ABANDONED', 'REJECTED', 'UNAVAILABLE', 'INVALID'] } },
    select: { id: true, triedSources: true, attempts: true },
  })

  // Pick the source (RuTracker first within its band + budget, Soulseek fallback). Manual picks enter
  // at the top priority band; triedSources still excludes a no-retry source already exhausted.
  const configs = await getDownloadSources()
  const src = chooseSource(10, prior?.triedSources ?? [], configs, await rtBudgetAvailable())
  if (!src) return { id: null, status: 'NO_SOURCE' as const }

  const settings = await resolveDownloadSettings()
  const data = {
    artistId: artist.id,
    mbReleaseId: mb.id,
    releaseGroupId: mb.releaseGroupId ?? null,
    title: mb.title,
    year: mb.year ?? null,
    source: src,
    status: 'DOWNLOADING' as const,
    error: null,
    slskUsername: null,
    quality: null,
    files: [] as Prisma.InputJsonValue,
    bytesTransferred: BigInt(0),
    lastProgressAt: new Date(),
    attempts: 0,
  }
  const row = prior
    ? await prisma.downloadedRelease.update({ where: { id: prior.id }, data })
    : await prisma.downloadedRelease.create({ data })

  const params = {
    artistId: artist.id,
    artistName: artist.name,
    albumTitle: mb.title,
    year: mb.year ?? null,
    mbReleaseId: mb.id,
    releaseGroupId: mb.releaseGroupId ?? null,
  }
  // routeAcquire spends the RuTracker budget + runs the torrent/slsk path as appropriate.
  const hit = await routeAcquire(src, params, row.id, settings.downloadFormats, settings.downloadMinBitrate)
  if (!hit) {
    src === 'RUTRACKER'
      ? await failRtMiss(row.id, 0, 'no RuTracker match (search miss)')
      : await prisma.downloadedRelease.update({ where: { id: row.id }, data: { status: 'FAILED', error: 'no Soulseek result found' } })
    return { id: null, status: 'NO_RESULT' as const }
  }
  return { id: row.id, status: 'DOWNLOADING' as const }
})
