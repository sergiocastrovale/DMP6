import type { Prisma } from '@prisma/client'
import { requirePermission } from '~/server/utils/permissions'
import { prisma } from '~/server/utils/prisma'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { isDownloadsEnabled } from '~/server/utils/acquisitionStatus'
import { routeAcquire } from '~/server/utils/autoDownload'

// One-click manual grab for a single MISSING release.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')

  const body = await readBody(event)
  const mbReleaseRowId = body?.mbReleaseRowId as string | undefined
  if (!mbReleaseRowId) {throw createError({ statusCode: 400, message: 'mbReleaseRowId required' })}

  // Re-download of an incomplete copy: the caller names the LocalRelease this download replaces.
  // Validate it here so a bad id can never reach merge, where it would silently no-op and leave two
  // copies fighting over the same library folder.
  const replacesLocalReleaseId = body?.replacesLocalReleaseId as string | undefined
  if (replacesLocalReleaseId) {
    const target = await prisma.localRelease.findUnique({ where: { id: replacesLocalReleaseId }, select: { id: true } })
    if (!target) {throw createError({ statusCode: 404, message: 'local release to replace not found' })}
  }

  const mb = await prisma.musicBrainzRelease.findUnique({
    where: { id: mbReleaseRowId },
    include: { artists: { include: { artist: true } } },
  })
  if (!mb) {throw createError({ statusCode: 404, message: 'release not found' })}

  // No MusicBrainz year = erroneous release (can't lay it out as `YYYY - title`). Discard it: record a
  // FAILED row (reusing any prior one) so it shows in the Failed list, and never grab it.
  if (mb.year == null) {
    const errored = await prisma.downloadedRelease.findFirst({ where: { mbReleaseId: mb.id }, select: { id: true } })
    const data = { status: 'FAILED' as const, error: 'no MusicBrainz year — erroneous release', stagingPath: null }
    const row = errored
      ? await prisma.downloadedRelease.update({ where: { id: errored.id }, data })
      : await prisma.downloadedRelease.create({
        data: { ...data, artistId: mb.artists[0]?.artist?.id ?? null, mbReleaseId: mb.id, releaseGroupId: mb.releaseGroupId ?? null, title: mb.title, year: null },
      }).catch(() => null)
    return { id: row?.id ?? null, status: 'NO_YEAR' as const }
  }

  // Key lookups on the stable releaseGroupId when we have one — mb.id (MusicBrainzRelease.id) is a
  // cuid that sync/catalogue-gaps can delete + recreate, so a prior/in-flight row created against a
  // now-stale id would otherwise go unnoticed and this "one-click grab" would double-download.
  const dedupKey = mb.releaseGroupId ? { releaseGroupId: mb.releaseGroupId } : { mbReleaseId: mb.id }

  // Already in flight / ready to merge / promoted? Don't double-grab.
  const existing = await prisma.downloadedRelease.findFirst({
    where: { ...dedupKey, status: { in: ['SEARCHING', 'DOWNLOADING', 'ENRICHING', 'READY', 'PROMOTED'] } },
    select: { id: true, status: true },
  })
  if (existing) {
    // An in-flight row that predates this click knows nothing about the copy it should replace -
    // stamp it now, or the merge would leave the incomplete copy sitting next to the new one.
    if (replacesLocalReleaseId) {
      await prisma.downloadedRelease.update({ where: { id: existing.id }, data: { replacesLocalReleaseId } })
    }
    return { id: existing.id, status: existing.status, alreadyQueued: true }
  }

  const artist = mb.artists[0]?.artist
  if (!artist) {throw createError({ statusCode: 409, message: 'release has no artist' })}

  if (!(await isDownloadsEnabled())) {return { id: null, status: 'NO_SOURCE' as const }}

  // Manual override: reuse a prior FAILED/ABANDONED/UNAVAILABLE/INVALID row and reset the attempt cap
  // (a human deliberately forced this) so it isn't immediately re-abandoned.
  const prior = await prisma.downloadedRelease.findFirst({
    where: { ...dedupKey, status: { in: ['FAILED', 'ABANDONED', 'REJECTED', 'UNAVAILABLE', 'INVALID'] } },
    select: { id: true, attempts: true },
    orderBy: { updatedAt: 'desc' },
  })

  const settings = await resolveDownloadSettings()
  const data = {
    artistId: artist.id,
    mbReleaseId: mb.id,
    releaseGroupId: mb.releaseGroupId ?? null,
    title: mb.title,
    year: mb.year ?? null,
    status: 'SEARCHING' as const,
    error: null,
    slskUsername: null,
    quality: null,
    files: [] as Prisma.InputJsonValue,
    bytesTransferred: BigInt(0),
    lastProgressAt: new Date(),
    attempts: 0,
    replacesLocalReleaseId: replacesLocalReleaseId ?? null,
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
  const hit = await routeAcquire(params, row.id, settings.downloadFormats, settings.downloadMinBitrate)
  if (!hit) {
    await prisma.downloadedRelease.update({ where: { id: row.id }, data: { status: 'FAILED', error: 'no Soulseek result found' } })
    return { id: null, status: 'NO_RESULT' as const }
  }
  return { id: row.id, status: 'DOWNLOADING' as const }
})
