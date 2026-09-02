import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readdir, rename, unlink, rm, rmdir, access } from 'node:fs/promises'
import { join, basename, dirname, relative, sep } from 'node:path'
import { Prisma } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import type { MergeRow } from '~/types/download'
import { resolveDownloadSettings } from '~/server/utils/downloadSettings'
import { resolveMonitorSettings } from '~/server/utils/monitorSettings'
import { getSlskdActiveDownloads, cancelSlskdDownload } from '~/server/utils/slskd'
import { deleteTorrent } from '~/server/utils/qbittorrent'
import { runExclusive } from '~/server/utils/scriptLock'
import { monitorLog } from '~/server/utils/monitorLog'
import { setMergeProgress, clearMergeProgress } from '~/server/utils/mergeProgress'
import { songkongDirs } from '~/server/utils/songkongSettings'
import { streamCopyFile } from '~/server/utils/safeMove'

const execFileAsync = promisify(execFile)

// Cancelling/rejecting an ENRICHING row leaves its SongKong spool/done markers behind - the host
// drainer (songkong-drain.sh) treats a stale spool entry as "retry next tick" by design, so a
// cancelled download otherwise means eternal cron noise over a path that no longer exists.
async function cleanupSongkongMarkers(id: string): Promise<void> {
  const dirs = songkongDirs()
  await rm(join(dirs.spool, id), { force: true }).catch(() => {})
  await rm(join(dirs.done, id), { force: true }).catch(() => {})
}

function musicDir(): string {
  return process.env.MUSIC_DIR || process.env.NUXT_MUSIC_DIR || ''
}

/**
 * Run the Rust reconciler binary, serialized against every other script run in this process so it
 * never hits the binaries' exclusive DB lock (which hard-exits on contention).
 */
async function runReconciler(name: 'index' | 'sync', args: string[]): Promise<void> {
  const root = process.env.PROJECT_ROOT || process.cwd()
  const scriptsDir = process.env.SCRIPTS_DIR || root
  const binary = join(scriptsDir, name)
  await runExclusive(() => execFileAsync(binary, args, { cwd: root, maxBuffer: 1024 * 1024 * 64 }))
}

async function moveDir(src: string, dest: string): Promise<void> {
  await mkdir(dirname(dest), { recursive: true })
  try {
    await rename(src, dest)
    return
  }
  catch (e: any) {
    if (!['EXDEV', 'EACCES', 'EPERM', 'ENOTEMPTY'].includes(e?.code)) {throw e}
  }
  // Cross-device / permission fallback: copy file-by-file then remove the source tree (see
  // safeMove.ts's streamCopyFile for why this isn't fs.copyFile).
  await mkdir(dest, { recursive: true })
  const entries = await readdir(src, { withFileTypes: true })
  for (const ent of entries) {
    const from = join(src, ent.name)
    const to = join(dest, ent.name)
    if (ent.isDirectory()) {await moveDir(from, to)}
    else { await streamCopyFile(from, to); await unlink(from).catch(() => {}) }
  }
  await rmdir(src).catch(() => {})
}

/** Relative layout path under a root; falls back to the folder basename if outside the root. */
function relUnder(root: string, full: string): string {
  const rel = root ? relative(root, full) : ''
  return !rel || rel.startsWith('..') ? basename(full) : rel
}

/**
 * Finalize a finished download: move it from the staging area into the `_ready` folder and mark it
 * READY (awaiting manual merge). No library write yet. Same relative layout is preserved so merge can
 * mirror it into MUSIC_DIR. This is the automatic, hands-off step — there is no approval gate.
 */
export async function moveToReady(id: string): Promise<void> {
  const row = await prisma.downloadedRelease.findUnique({ where: { id } })
  if (!row) {throw createError({ statusCode: 404, message: 'download not found' })}

  // Erroneous release (no MusicBrainz year — can't lay it out as `YYYY - title`): never promote to
  // _ready. Purge the staged files and mark it terminal — this can never resolve itself on retry (the
  // year comes from the matched MB release, not from anything a re-download would change), so ABANDONED
  // (not FAILED) keeps it out of the retry pool instead of lingering, retryable-looking, in the Failed
  // tab. Safety net for anything that got past the pick gate (in-flight at deploy, ENRICHING/torrent
  // finalize) — pickFresh/pickRetry already filter `year IS NOT NULL` so this shouldn't recur anyway.
  if (row.year == null) {
    await purgeStagedFiles(row.stagingPath)
    await prisma.downloadedRelease.update({
      where: { id },
      data: { status: 'ABANDONED', error: 'no MusicBrainz year — erroneous release', stagingPath: null },
    })
    monitorLog('warn', `merge: "${row.title}" has no MusicBrainz year — erroneous, sent to Abandoned`)
    return
  }

  if (!row.stagingPath) {throw createError({ statusCode: 409, message: 'nothing staged' })}

  const { downloadsPath, downloadsReadyPath } = await resolveDownloadSettings()
  if (!downloadsReadyPath) {throw createError({ statusCode: 503, message: 'DOWNLOADS_PATH not configured' })}

  // Already in the ready folder? just flag it.
  if (row.stagingPath.startsWith(downloadsReadyPath + sep) || row.stagingPath === downloadsReadyPath) {
    await prisma.downloadedRelease.update({ where: { id }, data: { status: 'READY' } })
    return
  }

  const dest = join(downloadsReadyPath, relUnder(downloadsPath, row.stagingPath))
  await moveDir(row.stagingPath, dest)
  await prisma.downloadedRelease.update({ where: { id }, data: { status: 'READY', stagingPath: dest } })
}

// Trailing disc subfolder (cd1 / disc 2 / disk3) — LocalRelease.folderPath is the rel path with this stripped.
const DISC_SEGMENT_RE = /[/\\](?:cd|disc|disk)\s*\d+\s*$/i
const stripDiscSegment = (rel: string): string => rel.replace(DISC_SEGMENT_RE, '')

// In-process claim guard against double-merging the same row (manual double-click racing itself, or
// racing runAutoMergeCycle) — mirrors monitorLoop.ts's `finalizing` Set. Merge only ever runs on the
// primary/NAS instance (single process), so an in-process Set is sufficient; no cross-instance DB claim
// needed (see audit item 4 / Q3).
const merging = new Set<string>()

// Delete a merged folder from disk, but only when it actually lives under MUSIC_DIR (safety guard).
async function purgeLibraryFolder(music: string, rel: string): Promise<void> {
  if (!music || !rel) {return}
  const full = join(music, rel)
  if (full.startsWith(music + sep)) {
    await rm(full, { recursive: true, force: true }).catch(() => {})
  }
}

// Move one ready release into MUSIC_DIR (idempotent: skip if already there) and return its rel path.
async function moveIntoLibrary(row: MergeRow, music: string, readyPath: string): Promise<string> {
  if (row.stagingPath!.startsWith(music + sep) || row.stagingPath === music) {
    return relUnder(music, row.stagingPath!) // already merged on disk; just (re)index in place
  }
  // Guard: the staged path MUST live under the ready folder. If not, the environment is misconfigured
  // (e.g. merging from a dev instance against the shared DB) — fail loudly instead of silently
  // basename-falling-back and writing to the wrong place under MUSIC_DIR.
  if (!row.stagingPath!.startsWith(readyPath + sep) && row.stagingPath !== readyPath) {
    throw createError({
      statusCode: 409,
      message: `staged path "${row.stagingPath}" is not under the ready folder "${readyPath}" — run merge where the files live (the NAS), not a dev instance`,
    })
  }
  const rel = relative(readyPath, row.stagingPath!)
  // The staged folder must physically exist here. If it's gone there are three possibilities:
  //   1. Interrupted merge — the files were already moved into the library (e.g. the container was
  //      recreated mid-merge by ./deploy, after moveDir but before the row was stamped). The library
  //      copy is present, so recover by finishing the merge against it (re-index + re-stamp).
  //   2. Truly gone (cleaned up / never landed) — nothing to merge, surface 409 so it can be rejected.
  //   3. Dev instance without the NAS downloads volume mounted — same 409, points at the real fix.
  const stagedExists = await access(row.stagingPath!).then(() => true).catch(() => false)
  if (!stagedExists) {
    const libExists = await access(join(music, rel)).then(() => true).catch(() => false)
    if (libExists) {
      return rel // already moved by an interrupted merge — re-index/re-stamp in place
    }
    throw createError({
      statusCode: 409,
      message: `Staged files not found at "${row.stagingPath}". They were already moved/cleaned up, or the downloads volume isn't mounted here (dev instance). If the files are gone, reject this download.`,
    })
  }
  await moveDir(row.stagingPath!, join(music, rel))
  return rel
}

/**
 * Validate one merged release against MusicBrainz, then keep it (matched) or discard it (INVALID).
 * The match result is the validity gate:
 *   - `index --folders` already created the LocalRelease from the moved files;
 *   - `sync --release <id>` (targeted, so it SKIPS the destructive per-artist catalogue-gaps
 *     delete+recreate) tries to link it to a real MB edition via embedded MB tags and fetch the real
 *     tracks/status, setting LocalRelease.releaseId;
 *   - matched (releaseId set) -> stamp provenance, PROMOTED, retire the now-owned group placeholder;
 *   - unmatched (releaseId NULL) -> files have no MB identity -> delete folder + LocalRelease (cascade),
 *     mark the download INVALID (retryable until the attempts cap, then ABANDONED) so the trickle
 *     worker can hope a properly-tagged copy surfaces.
 * Returns { id: localReleaseId, error: null } on success, { id: null, error: reason } when invalidated.
 */
async function stampMerged(row: MergeRow, music: string, rel: string, maxDownloadAttempts: number): Promise<{ id: string | null; error: string | null }> {
  const stripped = stripDiscSegment(rel)
  // Exact match first - "Artist/2001 - Album" must not match "Artist/2001 - Album (Deluxe)". Only fall
  // back to a prefix match for genuine disc subfolders ("Artist/2001 - Album/cd2"), constrained to a
  // path separator boundary so it can't swallow a sibling release with a longer name.
  const lr = await prisma.localRelease.findFirst({
    where: { OR: [{ folderPath: rel }, { folderPath: stripped }] },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  }) ?? await prisma.localRelease.findFirst({
    where: { folderPath: { startsWith: `${stripped}/` } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })

  // Targeted reconcile of just this release (non-destructive: never touches sibling MISSING placeholders).
  // --artist-hint: on a collab release (multiple main artists), prefer syncing/validating under the
  // artist this download was actually for, not whichever main artist sorts first alphabetically.
  let reconcilerFailed = false
  if (lr) {
    try {
      const args = ['--release', lr.id]
      if (row.artistId) {args.push('--artist-hint', row.artistId)}
      await runReconciler('sync', args)
    }
    catch (e: any) {
      reconcilerFailed = true
      monitorLog('error', `merge: sync --release failed for "${row.artist?.name ?? '?'} - ${row.title}": ${e?.message ?? e}`)
    }
  }

  const reloaded = lr
    ? await prisma.localRelease.findUnique({ where: { id: lr.id }, select: { id: true, releaseId: true, matchStatus: true, forcedComplete: true } })
    : null

  // Keep an exact match (matchStatus COMPLETE) or a superset (EXTRA_TRACKS — every MusicBrainz track
  // present, plus bonus/deluxe tracks the matched edition doesn't have). The Rust matcher already tries
  // to bind a deluxe sibling edition first when the local folder overshoots; EXTRA_TRACKS is what's left
  // when no such sibling exists, and is a legitimate copy, not a data-quality problem — never purge it.
  // forcedComplete is the manual "treat as complete" escape hatch — honour it. Only a genuine shortfall
  // (INCOMPLETE / MISSING_TRACKS, or no MB identity at all) is discarded and left to retry.
  const matched = !!reloaded?.releaseId
  const complete = matched && (reloaded!.forcedComplete || reloaded!.matchStatus === 'COMPLETE' || reloaded!.matchStatus === 'EXTRA_TRACKS')

  if (complete) {
    try {
      await prisma.$transaction([
        prisma.localRelease.update({ where: { id: reloaded!.id }, data: { downloadedFrom: row.source === 'RUTRACKER' ? 'rutracker' : 'slskd' } }),
        prisma.downloadedRelease.update({
          where: { id: row.id },
          data: { status: 'PROMOTED', stagingPath: join(music, rel), localReleaseId: reloaded!.id },
        }),
        // Retire the group placeholder(s) we downloaded against — it's now owned on disk, so it must
        // stop being a pickable MISSING row. Retire by the stable releaseGroupId (not the volatile
        // mbReleaseId cuid): sync/catalogue-gaps can delete+recreate the MISSING row with a fresh id
        // while a download was in flight, in which case retiring only row.mbReleaseId would no-op and
        // leave a look-alike MISSING placeholder behind, re-triggering the download loop.
        ...(row.releaseGroupId
          ? [prisma.musicBrainzRelease.deleteMany({ where: { releaseGroupId: row.releaseGroupId, status: 'MISSING' } })]
          : row.mbReleaseId
            ? [prisma.musicBrainzRelease.deleteMany({ where: { id: row.mbReleaseId, status: 'MISSING' } })]
            : []),
      ])
    }
    catch (e: any) {
      // P2002: another DownloadedRelease already owns this LocalRelease (duplicate download of the
      // same release, or a re-merge of a previously-promoted row). The library copy is fine — just
      // mark this row PROMOTED without the localReleaseId link so it leaves the ready queue.
      if (e?.code === 'P2002' && e?.meta?.target?.includes?.('localReleaseId')) {
        await prisma.downloadedRelease.update({
          where: { id: row.id },
          data: { status: 'PROMOTED', stagingPath: join(music, rel) },
        })
        monitorLog('notice', `merge: "${row.artist?.name ?? '?'} - ${row.title}" already owned by another download row — promoted without link`)
      }
      else {
        throw e
      }
    }
    return { id: reloaded!.id, error: null }
  }

  if (reconcilerFailed) {
    // The reconciler tool itself failed (MB API down, lock stolen, OOM, network) — that says nothing
    // about whether the release genuinely lacks a MusicBrainz match. Keep the files (already moved into
    // the library) and leave the row READY so the next merge cycle retries the sync instead of a good
    // download getting purged over a transient hiccup.
    await prisma.downloadedRelease.update({
      where: { id: row.id },
      data: { status: 'READY', error: 'sync --release failed during merge — will retry' },
    })
    return { id: null, error: 'sync --release failed, retry pending' }
  }

  // Discard: either no MusicBrainz identity, or matched with a genuine shortfall (INCOMPLETE /
  // MISSING_TRACKS — fewer tracks than the matched edition). Either way the files are unusable for the
  // library. Remove them and bump the attempt cap so a complete copy can still surface later (the
  // MISSING placeholder is deliberately NOT retired here).
  let reason = 'no MusicBrainz identity after enrichment'
  if (matched) {
    const [expected, present] = await Promise.all([
      prisma.musicBrainzReleaseTrack.count({ where: { releaseId: reloaded!.releaseId! } }),
      prisma.localReleaseTrack.count({ where: { localReleaseId: reloaded!.id } }),
    ])
    reason = `incomplete: ${present}/${expected} tracks (${reloaded!.matchStatus})`
  }

  await purgeLibraryFolder(music, rel)
  if (lr) {await prisma.localRelease.delete({ where: { id: lr.id } }).catch(() => {})}
  if (matched && reloaded!.releaseId) {
    // sync --release just bound this LocalRelease to a real MB edition, which we're now discarding —
    // without this the edition becomes a permanent orphan on the artist page (nothing points at it,
    // it's non-MISSING so it isn't retried as a catalogue gap, and no sync sweep is scoped to a
    // download that happened after it last ran). Never touch a MISSING placeholder (that's the
    // re-downloadable stub, kept above), another LocalRelease still bound to it (duplicate-copy case),
    // or a release an owned-bundle claim (scripts/sync/src/owned.rs::claim_owned_bundle) has linked
    // via LocalReleaseTrack.mbTrackId — that link doesn't show up as LocalRelease.releaseId.
    await prisma.musicBrainzRelease.deleteMany({
      where: {
        id: reloaded!.releaseId,
        status: { not: 'MISSING' },
        localReleases: { none: {} },
        tracks: { none: { localTracks: { some: {} } } },
      },
    }).catch(() => {})
  }
  const attempts = (row.attempts ?? 0) + 1
  const abandoned = attempts >= Math.max(1, maxDownloadAttempts)
  await prisma.downloadedRelease.update({
    where: { id: row.id },
    data: {
      status: abandoned ? 'ABANDONED' : 'INVALID',
      attempts,
      priority: Math.max(0, (row.priority ?? 0) - 1),
      error: reason,
      stagingPath: null,
      files: Prisma.JsonNull,
    },
  })
  monitorLog('warn', `merge: "${row.artist?.name ?? '?'} - ${row.title}" ${reason} -> ${abandoned ? 'ABANDONED' : 'INVALID'}`)
  return { id: null, error: reason }
}

/**
 * Merge one READY download into the library: move READY → MUSIC_DIR (idempotent), reconcile
 * (index + sync, serialized), stamp provenance, mark PROMOTED.
 */
export async function mergeDownloadedRelease(id: string, emit?: (line: string) => void): Promise<{ localReleaseId: string | null; error: string | null }> {
  if (merging.has(id)) {throw createError({ statusCode: 409, message: 'already merging' })}

  const row = await prisma.downloadedRelease.findUnique({ where: { id }, include: { artist: { select: { name: true } } } })
  if (!row) {throw createError({ statusCode: 404, message: 'download not found' })}
  if (row.status !== 'READY') {throw createError({ statusCode: 409, message: `cannot merge a "${row.status}" download — must be READY` })}
  if (!row.stagingPath) {throw createError({ statusCode: 409, message: 'nothing to merge' })}

  const music = musicDir()
  if (!music) {throw createError({ statusCode: 503, message: 'MUSIC_DIR not configured' })}
  const { downloadsReadyPath } = await resolveDownloadSettings()

  const { maxDownloadAttempts } = await resolveMonitorSettings()
  const title = row.title ?? '?'
  merging.add(id)
  try {
    setMergeProgress(id, { step: 'moving', title })
    emit?.(`Moving "${title}" to library…`)
    const rel = await moveIntoLibrary(row, music, downloadsReadyPath)
    setMergeProgress(id, { step: 'indexing', title })
    emit?.(`Indexing "${title}"…`)
    await runReconciler('index', ['--folders', rel])
    setMergeProgress(id, { step: 'syncing', title })
    emit?.(`Syncing "${title}"…`)
    const { id: localReleaseId, error } = await stampMerged(row, music, rel, maxDownloadAttempts)
    if (localReleaseId) {
      emit?.(`✓ Merged "${title}"`)
    }
    else {
      emit?.(`✗ "${title}" invalidated: ${error}`)
    }
    return { localReleaseId, error }
  }
  finally {
    merging.delete(id)
    clearMergeProgress(id)
  }
}

/**
 * Batched merge of many READY downloads: move them all, then ONE index pass over all folders and
 * ONE sync per distinct artist (deduped) — far cheaper than per-release index+full-artist-sync, and
 * the whole thing runs serialized so it can't collide with the gaps worker on the Rust lock.
 */
export async function mergeManyDownloadedReleases(ids: string[], emit?: (line: string) => void): Promise<{ merged: number; errors: string[] }> {
  const music = musicDir()
  if (!music) {throw createError({ statusCode: 503, message: 'MUSIC_DIR not configured' })}
  const { downloadsReadyPath } = await resolveDownloadSettings()

  const fetched = await prisma.downloadedRelease.findMany({
    where: { id: { in: ids }, status: 'READY' },
    include: { artist: { select: { name: true } } },
  })
  // Skip anything a concurrent single-row merge already claimed (mergeDownloadedRelease's `merging`
  // guard) rather than racing it; claim the rest for the duration of this batch.
  const rows = fetched.filter(r => !merging.has(r.id))
  for (const r of rows) {merging.add(r.id)}

  const errors: string[] = []
  const moved: { row: MergeRow; rel: string }[] = []
  try {
    for (const row of rows) {
      if (!row.stagingPath) {
        const msg = `"${row.title}" has no staging path — skipped`
        errors.push(msg)
        emit?.(`✗ ${msg}`)
        clearMergeProgress(row.id)
        continue
      }
      setMergeProgress(row.id, { step: 'moving', title: row.title })
      emit?.(`Moving "${row.title}" to library…`)
      try {
        moved.push({ row, rel: await moveIntoLibrary(row, music, downloadsReadyPath) })
      }
      catch (e: any) {
        const msg = `Move failed "${row.title}": ${e?.message || e}`
        monitorLog('error', `merge: ${msg}`)
        clearMergeProgress(row.id)
        errors.push(msg)
        emit?.(`✗ ${msg}`)
      }
    }
    if (moved.length === 0) {
      return { merged: 0, errors }
    }

    // One index over all folders (--folders is ';'-separated); skip paths containing ';'.
    for (const m of moved) {setMergeProgress(m.row.id, { step: 'indexing', title: m.row.title })}
    emit?.(`Indexing ${moved.length} release${moved.length === 1 ? '' : 's'}…`)
    const safeRels = moved.map(m => m.rel).filter(r => !r.includes(';'))
    if (safeRels.length) {await runReconciler('index', ['--folders', safeRels.join(';')])}
    for (const m of moved.filter(m => m.rel.includes(';'))) {await runReconciler('index', ['--folders', m.rel])}

    // Per-release targeted validate-or-invalidate (each runs its own `sync --release`, never a
    // destructive per-artist sync). Matched releases are kept + PROMOTED; unmatched go INVALID.
    const { maxDownloadAttempts } = await resolveMonitorSettings()
    let promoted = 0
    for (const m of moved) {
      setMergeProgress(m.row.id, { step: 'syncing', title: m.row.title })
      emit?.(`Syncing "${m.row.title}"…`)
      const { id: localReleaseId, error } = await stampMerged(m.row, music, m.rel, maxDownloadAttempts)
      if (localReleaseId) {
        promoted++
        emit?.(`✓ "${m.row.title}"`)
      }
      else {
        const msg = `"${m.row.title}" invalidated: ${error}`
        errors.push(msg)
        emit?.(`✗ ${msg}`)
      }
    }
    if (promoted > 0) {emit?.(`✓ Merged ${promoted} release${promoted === 1 ? '' : 's'}`)}
    return { merged: promoted, errors }
  }
  finally {
    for (const m of moved) {clearMergeProgress(m.row.id)}
    for (const r of rows) {merging.delete(r.id)}
  }
}

// slskd filenames can use backslash separators (Windows peers) — normalize before basename.
const baseName = (f: string) => basename(f.replace(/\\/g, '/'))

// Delete the staged folder from disk, but only inside the configured downloads/staging or ready
// roots (safety) — used by both reject and cancel.
async function purgeStagedFiles(stagingPath: string | null): Promise<void> {
  if (!stagingPath) {return}
  const { downloadsPath, downloadsReadyPath } = await resolveDownloadSettings()
  const inside = (root: string) => root && (stagingPath.startsWith(root + sep) || stagingPath === root)
  if (!downloadsPath || inside(downloadsPath) || inside(downloadsReadyPath)) {
    await rm(stagingPath, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Count a reject/cancel against the shared `attempts` cap (MAX_DOWNLOAD_ATTEMPTS) and clear the staged
 * files reference:
 *   - below the cap -> back to FAILED (re-pickable after the retry cooldown), so the auto-downloader
 *     can fetch it again (a different source may be good).
 *   - at/above the cap -> REJECTED, a terminal tombstone excluded from pickCandidates, never re-fetched.
 * The counter accumulates across the whole download→ready→reject lifecycle, so the try/ready/reject
 * churn is bounded by N. A manual download from the artist page resets the cap (deliberate override).
 */
async function applyRejectionCap(row: { id: string; attempts: number }, reason: string): Promise<void> {
  const { maxDownloadAttempts } = await resolveMonitorSettings()
  const attempts = (row.attempts ?? 0) + 1
  const terminal = attempts >= Math.max(1, maxDownloadAttempts)
  await prisma.downloadedRelease.update({
    where: { id: row.id },
    data: { status: terminal ? 'REJECTED' : 'FAILED', attempts, error: reason, stagingPath: null, files: Prisma.JsonNull },
  })
}

/** Reject a staged download (FAILED or READY/ready-to-merge — identical outcome). */
export async function rejectDownloadedRelease(id: string): Promise<void> {
  const row = await prisma.downloadedRelease.findUnique({ where: { id } })
  if (!row) {throw createError({ statusCode: 404, message: 'download not found' })}
  await purgeStagedFiles(row.stagingPath)
  await cleanupSongkongMarkers(id)
  await applyRejectionCap(row, 'rejected by user')
}

/**
 * Bulk "Reject all"/"Reject selected": unlike the single-row reject (which is a soft, cap-counted
 * miss so the auto-downloader can retry with a different source), an explicit bulk reject is the user
 * telling us they never want these back — go straight to the terminal REJECTED state, bypassing the
 * attempts cap. Without this, rejecting a batch of FAILED rows with attempts still below the cap just
 * cycles them back to FAILED (attempts+1) and the list looks completely unchanged.
 */
export async function forceRejectDownloadedReleases(ids: string[]): Promise<{ rejected: number }> {
  const rows = await prisma.downloadedRelease.findMany({ where: { id: { in: ids } } })
  for (const row of rows) {
    await purgeStagedFiles(row.stagingPath)
    await cleanupSongkongMarkers(row.id)
  }
  const result = await prisma.downloadedRelease.updateMany({
    where: { id: { in: ids } },
    data: { status: 'REJECTED', error: 'rejected by user', stagingPath: null, files: Prisma.JsonNull },
  })
  return { rejected: result.count }
}

// Backdated far enough that `updatedAt <= now() - make_interval(days => cooldownDays)` is true for
// any realistic retryCooldownDays value, so a requeued row is immediately eligible for pickRetry
// instead of waiting out a fresh cooldown window.
const REQUEUE_EPOCH = new Date(0)

/**
 * "Move back to queue" (Rejected tab): the inverse of forceRejectDownloadedReleases. Resets the row
 * to FAILED with attempts back at 0 and an immediately-eligible `updatedAt`, so the trickle worker's
 * normal retry pool (pickRetry, gated by retryCooldownDays) picks it up on its own next cycle —
 * deliberately NOT an immediate forced search (that's "Force retry", a different action).
 */
export async function requeueRejectedDownload(id: string): Promise<void> {
  const row = await prisma.downloadedRelease.findUnique({ where: { id } })
  if (!row) {throw createError({ statusCode: 404, message: 'download not found' })}
  await prisma.downloadedRelease.update({
    where: { id },
    data: { status: 'FAILED', attempts: 0, priority: 10, error: null, updatedAt: REQUEUE_EPOCH },
  })
}

/** Bulk "Move all back to queue" — same semantics as requeueRejectedDownload, batched. */
export async function requeueRejectedDownloads(ids: string[]): Promise<{ requeued: number }> {
  const result = await prisma.downloadedRelease.updateMany({
    where: { id: { in: ids } },
    data: { status: 'FAILED', attempts: 0, priority: 10, error: null, updatedAt: REQUEUE_EPOCH },
  })
  return { requeued: result.count }
}

/**
 * GC terminal `DownloadedRelease` rows (UNAVAILABLE/FAILED/INVALID/ABANDONED/REJECTED) that no longer
 * serve any purpose: their release (matched by the stable releaseGroupId, falling back to the volatile
 * mbReleaseId only for legacy rows predating that column) is no longer MISSING — either it was
 * fulfilled by another download, or the MusicBrainzRelease/group is gone entirely. Both pickFresh and
 * pickRetry only ever consider MISSING releases, so such a row can no longer influence acquisition
 * either way; keeping it around only bloats the table and every /downloads queue poll (see
 * docs/downloader_issues.md #3, #8). Pure DB operation — no filesystem dependency, safe on any instance.
 */
/**
 * Drop a staged download the library turned out to already own.
 *
 * Sync's gap pass claims a release whose every track is already inside a bigger local release (a bonus
 * disc in a two-disc folder — see scripts/sync/src/owned.rs) and stamps the MusicBrainzRelease with
 * `Owned as part of "<folder>"`. Anything already downloaded for that group is a duplicate: merging it
 * would add a second copy of tracks that are on disk. Rejecting from here (rather than from the Rust
 * pass) is deliberate — this is where staged files and SongKong markers get cleaned up properly.
 *
 * Matched on that reason specifically, not on "no longer MISSING": only a claim we made ourselves is
 * strong enough to justify discarding files without asking.
 */
export async function rejectOwnedElsewhereDownloads(): Promise<{ rejected: number }> {
  const rows = await prisma.$queryRaw<{ id: string, stagingPath: string | null, reason: string }[]>`
    SELECT dr.id, dr."stagingPath", mr."statusReason" AS reason
    FROM "DownloadedRelease" dr
    JOIN "MusicBrainzRelease" mr ON (
      (dr."releaseGroupId" IS NOT NULL AND mr."releaseGroupId" = dr."releaseGroupId")
      OR (dr."releaseGroupId" IS NULL AND mr.id = dr."mbReleaseId")
    )
    WHERE dr.status = 'READY'
      AND mr.status <> 'MISSING'
      AND mr."statusReason" LIKE 'Owned as part of%'
  `
  if (rows.length === 0) {
    return { rejected: 0 }
  }
  for (const row of rows) {
    await purgeStagedFiles(row.stagingPath)
    await cleanupSongkongMarkers(row.id)
  }
  const result = await prisma.downloadedRelease.updateMany({
    where: { id: { in: rows.map(r => r.id) } },
    data: { status: 'REJECTED', error: rows[0]!.reason, stagingPath: null, files: Prisma.JsonNull },
  })
  monitorLog('notice', `cleanup: rejected ${result.count} staged download(s) already owned inside another release`)
  return { rejected: result.count }
}

export async function sweepDanglingDownloads(): Promise<{ removed: number }> {
  const removed = await prisma.$executeRaw`
    DELETE FROM "DownloadedRelease" dr
    WHERE dr.status IN ('UNAVAILABLE', 'FAILED', 'INVALID', 'ABANDONED', 'REJECTED')
      AND NOT EXISTS (
        SELECT 1 FROM "MusicBrainzRelease" mr
        WHERE mr.status = 'MISSING'
          AND (
            (dr."releaseGroupId" IS NOT NULL AND mr."releaseGroupId" = dr."releaseGroupId")
            OR (dr."releaseGroupId" IS NULL AND mr.id = dr."mbReleaseId")
          )
      )
  `
  if (removed > 0) {monitorLog('notice', `cleanup: swept ${removed} dangling/terminal download row(s) (release no longer MISSING)`)}
  return { removed: Number(removed) }
}

/**
 * Sweep the ready-to-merge queue for orphans: rows whose staged files no longer exist on disk (moved,
 * cleaned up, or never landed). Such rows can never be merged — delete them outright.
 *
 * Safety guard: this MUST run where the downloads volume is mounted (the NAS). If the ready root itself
 * is absent we're a dev instance without the volume — we can't distinguish "files gone" from "volume not
 * mounted", so we bail without touching anything rather than nuking the whole queue.
 */
export async function cleanupReadyDownloads(): Promise<{ removed: number; checked: number }> {
  const { downloadsReadyPath } = await resolveDownloadSettings()
  if (downloadsReadyPath) {
    const mounted = await access(downloadsReadyPath).then(() => true).catch(() => false)
    if (!mounted) {
      throw createError({
        statusCode: 409,
        message: `Downloads volume not mounted here ("${downloadsReadyPath}" absent) — run Cleanup on the NAS, not a dev instance.`,
      })
    }
  }

  const rows = await prisma.downloadedRelease.findMany({
    where: { status: 'READY', stagingPath: { not: null } },
    select: { id: true, stagingPath: true },
  })
  const orphans: string[] = []
  for (const row of rows) {
    const exists = await access(row.stagingPath!).then(() => true).catch(() => false)
    if (!exists) {
      orphans.push(row.id)
    }
  }
  if (orphans.length) {
    await prisma.downloadedRelease.deleteMany({ where: { id: { in: orphans } } })
    monitorLog('notice', `cleanup: removed ${orphans.length} ready-to-merge row(s) with missing staged files`)
  }
  return { removed: orphans.length, checked: rows.length }
}

/**
 * Cancel an in-flight download (SEARCHING/DOWNLOADING/ENRICHING): kill the live slskd transfers and
 * remove all of its files, then count it against the same attempts cap as reject (below cap ->
 * FAILED/re-downloadable, at cap -> REJECTED/terminal). Same N-bounded outcome as FAILED/READY
 * rejection.
 */
export async function cancelDownloadedRelease(id: string): Promise<void> {
  const row = await prisma.downloadedRelease.findUnique({ where: { id } })
  if (!row) {throw createError({ statusCode: 404, message: 'download not found' })}

  const files = (row.files as Array<{ filename: string }> | null) ?? []
  if (row.source === 'RUTRACKER' && row.torrentHash) {
    // Delete the torrent + its data, but only if no other album from the same pack still needs it.
    const siblings = await prisma.downloadedRelease.count({
      where: { torrentHash: row.torrentHash, status: { in: ['SEARCHING', 'DOWNLOADING', 'ENRICHING'] }, id: { not: row.id } },
    })
    if (siblings === 0) {await deleteTorrent(row.torrentHash, true)}
  }
  else if (row.slskUsername && files.length) {
    const transfers = await getSlskdActiveDownloads().catch(() => [])
    const expected = new Set(files.map(f => baseName(String(f.filename))))
    const ours = transfers.filter(t => t.username === row.slskUsername && expected.has(baseName(t.filename)))
    // remove=true tells slskd to delete the (partial) file as it cancels the transfer.
    for (const t of ours) {await cancelSlskdDownload(row.slskUsername!, t.id).catch(() => {})}
  }
  await purgeStagedFiles(row.stagingPath)
  await cleanupSongkongMarkers(id)
  await applyRejectionCap(row, 'cancelled by user')
}
