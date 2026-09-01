import { Prisma } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { prowlarrSearch } from '~/server/utils/prowlarr'
import {
  addTorrentPaused,
  getTorrentFiles,
  setFilePriorities,
  startTorrent,
  deleteTorrent,
} from '~/server/utils/qbittorrent'
import { matchTorrentFolders } from '~/server/utils/torrentMatch'
import type { MatchableRelease, TorrentAcquireParams } from '~/types/download'
import { monitorLog } from '~/server/utils/monitorLog'

// Statuses meaning "this release is already being handled" — used to avoid creating a duplicate row
// for a sibling album when extracting it from a pack.
const ACTIVE = ['DOWNLOADING', 'ENRICHING', 'READY', 'PROMOTED'] as const

const MAX_RESULTS_TRIED = 6 // how many Prowlarr hits to inspect before giving up on this release

// MISSING album/EP releases for this artist — candidates to fill from a pack in one grab. At most one
// edition per release group: sync/catalogue-gaps normally write one MISSING row per group, but a stray
// duplicate (race, manual data fix) must not let a torrent match + fill the same album twice.
async function missingReleasesForArtist(artistId: string): Promise<MatchableRelease[]> {
  return prisma.$queryRaw<MatchableRelease[]>(Prisma.sql`
    SELECT DISTINCT ON (COALESCE(mr."releaseGroupId", mr.id))
           mr.id, mr.title, mr.year, mr."releaseGroupId"
    FROM "MusicBrainzRelease" mr
    JOIN "ReleaseType" rt ON rt.id = mr."typeId" AND rt.slug IN ('album', 'ep')
    JOIN "MusicBrainzReleaseArtist" mra ON mra."releaseId" = mr.id AND mra."artistId" = ${artistId}
    WHERE mr.status = 'MISSING'
    ORDER BY COALESCE(mr."releaseGroupId", mr.id), mr."updatedAt" DESC
  `)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Acquire a MISSING release from RuTracker via Prowlarr (search) + qBittorrent (download).
 *
 * For each candidate Prowlarr result, the torrent is added PAUSED so we can read its file tree before
 * downloading. We match the album folders inside it against this artist's MISSING releases:
 *  - if the triggering release isn't present, the torrent is deleted and we try the next result;
 *  - otherwise we download ONLY the matched folders (everything else set to priority 0) and create a
 *    DownloadedRelease row per matched album — so a discography pack fills every gap it covers at once.
 *
 * Returns the trigger row id on success, or null on a miss (no torrent contained the release) so the
 * caller can fall back to the next source. The reconciler (reconcileTorrentDownloads) finalizes them.
 */
export async function acquireTorrentRelease(
  params: TorrentAcquireParams,
  triggerRowId: string,
): Promise<{ id: string } | null> {
  const settings = await resolveDownloadSettings()
  if (!settings.qbittorrentUrl || !settings.prowlarrUrl || !settings.qbittorrentSavePath) {return null}

  const results = await prowlarrSearch(`${params.artistName} ${params.albumTitle}`.trim()).catch(() => [])
  if (results.length === 0) {return null}

  const missing = await missingReleasesForArtist(params.artistId)
  // Always include the trigger release even if (rarely) not in the MISSING set yet.
  if (params.mbReleaseId && !missing.some(m => m.id === params.mbReleaseId)) {
    missing.push({ id: params.mbReleaseId, title: params.albumTitle, year: params.year, releaseGroupId: params.releaseGroupId })
  }

  for (const result of results.slice(0, MAX_RESULTS_TRIED)) {
    const tag = `dmp-${triggerRowId}-${Date.now()}`
    let hash: string
    try {
      hash = await addTorrentPaused(result.downloadUrl, settings.qbittorrentSavePath, tag)
    }
    catch (e: any) {
      monitorLog('warn', `rutracker: add failed for "${result.title}": ${e?.message || e}`)
      continue
    }

    // Wait for metadata (magnets resolve their file list asynchronously).
    let files = await getTorrentFiles(hash)
    for (let i = 0; i < 20 && files.length === 0; i++) { await sleep(1500); files = await getTorrentFiles(hash) }
    if (files.length === 0) { await deleteTorrent(hash, true); continue }

    const matches = matchTorrentFolders(files, missing)
    const trigger = params.mbReleaseId ? matches.find(m => m.release.id === params.mbReleaseId) : matches[0]
    if (!trigger) { await deleteTorrent(hash, true); continue } // target not in this torrent

    // Decide which matched albums we will actually fulfill (skip siblings already being handled).
    // Key on the stable releaseGroupId when present — mbReleaseId is a cuid that sync/catalogue-gaps
    // can delete + recreate, which would otherwise hide an already-in-flight sibling and re-grab it.
    const fulfill = [] as typeof matches
    for (const m of matches) {
      if (m.release.id === trigger.release.id) { fulfill.push(m); continue }
      const dedupKey = m.release.releaseGroupId
        ? { releaseGroupId: m.release.releaseGroupId }
        : m.release.id ? { mbReleaseId: m.release.id } : null
      const existing = dedupKey
        ? await prisma.downloadedRelease.findFirst({ where: { ...dedupKey, status: { in: ACTIVE as unknown as any[] } } })
        : null
      if (!existing) {fulfill.push(m)}
    }

    // Download only the fulfilled folders; deselect everything else.
    const wanted = new Set(fulfill.flatMap(m => m.fileIndexes))
    const unwanted = files.map(f => f.index).filter(i => !wanted.has(i))
    await setFilePriorities(hash, unwanted, 0).catch(() => {})

    // Create/refresh one DownloadedRelease row per fulfilled album, all sharing this torrent hash.
    for (const m of fulfill) {
      const data = {
        artistId: params.artistId,
        mbReleaseId: m.release.id,
        releaseGroupId: m.release.releaseGroupId,
        title: m.release.title,
        year: m.release.year,
        source: 'RUTRACKER' as const,
        status: 'DOWNLOADING' as const,
        torrentHash: hash,
        torrentFolder: m.folder,
        quality: result.format !== 'Unknown' ? result.format : null,
        slskUsername: null,
        files: m.files as unknown as Prisma.InputJsonValue,
        error: null,
        bytesTransferred: BigInt(0),
        lastProgressAt: new Date(),
      }
      if (m.release.id === trigger.release.id) {
        await prisma.downloadedRelease.update({ where: { id: triggerRowId }, data })
      }
      else {
        const dedupKey = m.release.releaseGroupId ? { releaseGroupId: m.release.releaseGroupId } : { mbReleaseId: m.release.id }
        const existing = await prisma.downloadedRelease.findFirst({ where: dedupKey, orderBy: { updatedAt: 'desc' } })
        existing
          ? await prisma.downloadedRelease.update({ where: { id: existing.id }, data })
          : await prisma.downloadedRelease.create({ data })
      }
    }

    await startTorrent(hash)
    monitorLog('notice', `rutracker: "${result.title}" -> ${fulfill.length} release(s) downloading (hash ${hash.slice(0, 8)})`)
    return { id: triggerRowId }
  }

  return null // no candidate contained the release
}
