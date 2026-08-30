import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeArtist, makeDownloadedRelease, makeLocalRelease, makeLocalTrack, makeMbRelease, makeMbTrack } from '../../../test/factories'

const deleteTorrentMock = vi.fn().mockResolvedValue(undefined)
vi.mock('~/server/utils/qbittorrent', () => ({
  deleteTorrent: (...args: unknown[]) => deleteTorrentMock(...args),
}))
vi.mock('~/server/utils/slskd', () => ({
  getSlskdActiveDownloads: vi.fn().mockResolvedValue([]),
  cancelSlskdDownload: vi.fn().mockResolvedValue(undefined),
}))

const execFileMock = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => execFileMock(...args),
}))

const prisma = getTestPrisma()

describe('promote.ts (real Postgres)', () => {
  beforeAll(async () => {
    process.env.MUSIC_DIR = ''
  })

  beforeEach(async () => {
    await resetDb()
    deleteTorrentMock.mockClear()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('moveToReady: a release with no MusicBrainz year is purged and marked ABANDONED (terminal — never promoted to _ready, never retried)', async () => {
    const { moveToReady } = await import('../../../server/utils/promote')
    const dl = await makeDownloadedRelease(prisma, {
      year: null,
      status: 'ENRICHING',
      stagingPath: '/tmp/dmp-test-nonexistent-staging',
    })
    await moveToReady(dl.id)
    const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl.id } })
    expect(after.status).toBe('ABANDONED')
    expect(after.error).toMatch(/no MusicBrainz year/)
    expect(after.stagingPath).toBeNull()
  })

  it('cleanupReadyDownloads: bails with 409 and deletes nothing when the ready volume is not mounted here', async () => {
    const { cleanupReadyDownloads } = await import('../../../server/utils/promote')
    const missingRoot = `/tmp/dmp-test-missing-${randomUUID()}`
    await prisma.settings.upsert({
      where: { id: 'main' },
      create: { id: 'main', downloadsPath: missingRoot },
      update: { downloadsPath: missingRoot },
    })
    const orphan = await makeDownloadedRelease(prisma, {
      status: 'READY',
      stagingPath: `${missingRoot}/_ready/Some Artist/2020 - Album`,
    })

    await expect(cleanupReadyDownloads()).rejects.toMatchObject({ statusCode: 409 })

    const stillThere = await prisma.downloadedRelease.findUnique({ where: { id: orphan.id } })
    expect(stillThere).not.toBeNull()
  })

  it('cancelDownloadedRelease: does NOT delete the shared torrent while a sibling from the same pack is still downloading', async () => {
    const { cancelDownloadedRelease } = await import('../../../server/utils/promote')
    const torrentHash = `hash-${randomUUID()}`
    const a = await makeDownloadedRelease(prisma, { source: 'RUTRACKER', status: 'DOWNLOADING', torrentHash, attempts: 0 })
    await makeDownloadedRelease(prisma, { source: 'RUTRACKER', status: 'DOWNLOADING', torrentHash })

    await cancelDownloadedRelease(a.id)

    expect(deleteTorrentMock).not.toHaveBeenCalled()
    const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: a.id } })
    expect(after.status).toBe('FAILED') // attempts 0 -> 1, below the default cap of 3
  })

  it('cancelDownloadedRelease: DOES delete the torrent once no sibling from the pack remains in flight', async () => {
    const { cancelDownloadedRelease } = await import('../../../server/utils/promote')
    const torrentHash = `hash-${randomUUID()}`
    const a = await makeDownloadedRelease(prisma, { source: 'RUTRACKER', status: 'DOWNLOADING', torrentHash })
    await makeDownloadedRelease(prisma, { source: 'RUTRACKER', status: 'PROMOTED', torrentHash })

    await cancelDownloadedRelease(a.id)

    expect(deleteTorrentMock).toHaveBeenCalledWith(torrentHash, true)
  })

  it('rejectDownloadedRelease: crosses the attempts cap into REJECTED (terminal) instead of FAILED (retryable)', async () => {
    const { rejectDownloadedRelease } = await import('../../../server/utils/promote')
    // Default maxDownloadAttempts is 3 (no Settings row / env override) - attempts=2 -> this reject
    // brings it to 3, which is >= the cap, so it goes terminal.
    const dl = await makeDownloadedRelease(prisma, { status: 'FAILED', attempts: 2 })
    await rejectDownloadedRelease(dl.id)
    const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl.id } })
    expect(after.status).toBe('REJECTED')
    expect(after.attempts).toBe(3)
  })

  it('rejectDownloadedRelease: stays FAILED (retryable) below the attempts cap', async () => {
    const { rejectDownloadedRelease } = await import('../../../server/utils/promote')
    const dl = await makeDownloadedRelease(prisma, { status: 'FAILED', attempts: 0 })
    await rejectDownloadedRelease(dl.id)
    const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl.id } })
    expect(after.status).toBe('FAILED')
    expect(after.attempts).toBe(1)
  })

  describe('cancel/reject clean up SongKong spool/done markers', () => {
    let stateDir: string

    beforeEach(async () => {
      stateDir = await mkdtemp(join(tmpdir(), 'dmp-songkong-'))
      await mkdir(join(stateDir, 'spool'), { recursive: true })
      await mkdir(join(stateDir, 'done'), { recursive: true })
      process.env.SONGKONG_STATE_DIR = stateDir
    })

    afterEach(async () => {
      delete process.env.SONGKONG_STATE_DIR
      await rm(stateDir, { recursive: true, force: true })
    })

    it('cancelDownloadedRelease removes both the spool and done marker for that row, if present', async () => {
      const { cancelDownloadedRelease } = await import('../../../server/utils/promote')
      const dl = await makeDownloadedRelease(prisma, { status: 'ENRICHING', attempts: 0 })
      await writeFile(join(stateDir, 'spool', dl.id), '')
      await writeFile(join(stateDir, 'done', dl.id), '')

      await cancelDownloadedRelease(dl.id)

      await expect(access(join(stateDir, 'spool', dl.id))).rejects.toThrow()
      await expect(access(join(stateDir, 'done', dl.id))).rejects.toThrow()
    })

    it('rejectDownloadedRelease removes the markers too', async () => {
      const { rejectDownloadedRelease } = await import('../../../server/utils/promote')
      const dl = await makeDownloadedRelease(prisma, { status: 'ENRICHING', attempts: 0 })
      await writeFile(join(stateDir, 'spool', dl.id), '')

      await rejectDownloadedRelease(dl.id)

      await expect(access(join(stateDir, 'spool', dl.id))).rejects.toThrow()
    })

    it('is a safe no-op when no marker files exist for that row (not every cancelled row was ever spooled)', async () => {
      const { cancelDownloadedRelease } = await import('../../../server/utils/promote')
      const dl = await makeDownloadedRelease(prisma, { status: 'FAILED', attempts: 0 })
      await expect(cancelDownloadedRelease(dl.id)).resolves.toBeUndefined()
    })
  })

  describe('forceRejectDownloadedReleases (bulk "Reject all")', () => {
    it('goes straight to REJECTED regardless of the attempts cap — unlike the single-row reject, it never cycles back to FAILED', async () => {
      const { forceRejectDownloadedReleases } = await import('../../../server/utils/promote')
      // Default maxDownloadAttempts is 3; attempts=0 is nowhere near the cap, so the soft single-row
      // reject would just bounce this back to FAILED (the reported bug: "Reject all" looked like a
      // no-op because most rows never crossed the cap in one call).
      const rows = await Promise.all(
        Array.from({ length: 5 }, () => makeDownloadedRelease(prisma, { status: 'FAILED', attempts: 0 })),
      )

      const { rejected } = await forceRejectDownloadedReleases(rows.map(r => r.id))

      expect(rejected).toBe(5)
      const after = await prisma.downloadedRelease.findMany({ where: { id: { in: rows.map(r => r.id) } } })
      expect(after.every(r => r.status === 'REJECTED')).toBe(true)
    })

    it('purges staged files for READY rows included in the bulk reject', async () => {
      const { forceRejectDownloadedReleases } = await import('../../../server/utils/promote')
      const missingRoot = `/tmp/dmp-test-missing-${randomUUID()}`
      await prisma.settings.upsert({
        where: { id: 'main' },
        create: { id: 'main', downloadsPath: missingRoot },
        update: { downloadsPath: missingRoot },
      })
      const dl = await makeDownloadedRelease(prisma, { status: 'READY', stagingPath: `${missingRoot}/_ready/Some Artist/2020 - Album` })

      await forceRejectDownloadedReleases([dl.id])

      const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl.id } })
      expect(after.status).toBe('REJECTED')
      expect(after.stagingPath).toBeNull()
    })
  })

  describe('requeueRejectedDownload(s) ("Move back to queue")', () => {
    it('single: resets a REJECTED row to FAILED with attempts back at 0', async () => {
      const { requeueRejectedDownload } = await import('../../../server/utils/promote')
      const dl = await makeDownloadedRelease(prisma, { status: 'REJECTED', attempts: 3, error: 'rejected by user' })

      await requeueRejectedDownload(dl.id)

      const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl.id } })
      expect(after.status).toBe('FAILED')
      expect(after.attempts).toBe(0)
      expect(after.priority).toBe(10)
      expect(after.error).toBeNull()
    })

    it('bulk: resets many REJECTED rows at once and reports the count', async () => {
      const { requeueRejectedDownloads } = await import('../../../server/utils/promote')
      const rows = await Promise.all(
        Array.from({ length: 4 }, () => makeDownloadedRelease(prisma, { status: 'REJECTED', attempts: 3 })),
      )

      const { requeued } = await requeueRejectedDownloads(rows.map(r => r.id))

      expect(requeued).toBe(4)
      const after = await prisma.downloadedRelease.findMany({ where: { id: { in: rows.map(r => r.id) } } })
      expect(after.every(r => r.status === 'FAILED' && r.attempts === 0)).toBe(true)
    })

    it('backdates updatedAt so the row is immediately eligible for pickRetry, bypassing a fresh cooldown', async () => {
      const { requeueRejectedDownload } = await import('../../../server/utils/promote')
      const dl = await makeDownloadedRelease(prisma, { status: 'REJECTED', attempts: 3 })

      await requeueRejectedDownload(dl.id)

      const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl.id } })
      // Any real retryCooldownDays value (default 7) is satisfied by an epoch timestamp.
      expect(after.updatedAt.getTime()).toBeLessThan(Date.now() - 7 * 24 * 60 * 60 * 1000)
    })
  })

  describe('mergeDownloadedRelease: sync --release tool failure', () => {
    let musicDirTmp: string
    let readyRootTmp: string

    beforeEach(async () => {
      musicDirTmp = await mkdtemp(join(tmpdir(), 'dmp-music-'))
      readyRootTmp = await mkdtemp(join(tmpdir(), 'dmp-ready-'))
      process.env.MUSIC_DIR = musicDirTmp
      await prisma.settings.upsert({
        where: { id: 'main' },
        create: { id: 'main', downloadsPath: readyRootTmp },
        update: { downloadsPath: readyRootTmp },
      })
      execFileMock.mockReset()
    })

    afterEach(async () => {
      process.env.MUSIC_DIR = ''
      await rm(musicDirTmp, { recursive: true, force: true })
      await rm(readyRootTmp, { recursive: true, force: true })
    })

    it('keeps files and requeues READY instead of purging/INVALID when sync --release itself fails (not a genuine no-match)', async () => {
      const { mergeDownloadedRelease } = await import('../../../server/utils/promote')

      const rel = 'Some Artist/2020 - Album'
      const stagingPath = join(readyRootTmp, '_ready', rel)
      await mkdir(stagingPath, { recursive: true })
      await writeFile(join(stagingPath, 'track.flac'), 'fake-audio')

      const dl = await makeDownloadedRelease(prisma, { status: 'READY', stagingPath, title: 'Album' })
      // Stand-in for the LocalRelease a real `index --folders` run would have created (execFile is mocked).
      await makeLocalRelease(prisma, { folderPath: rel, matchStatus: 'UNMATCHED', releaseId: null })

      let call = 0
      execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: (e: Error | null, o: string, err: string) => void) => {
        call++
        if (call === 1) {cb(null, '', '')} // index --folders: no-op success
        else {cb(new Error('sync: MusicBrainz API unavailable (503)'), '', '')} // sync --release: tool failure
      })

      const { localReleaseId, error } = await mergeDownloadedRelease(dl.id)

      expect(localReleaseId).toBeNull()
      expect(error).toMatch(/sync --release failed/)

      const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl.id } })
      expect(after.status).toBe('READY')
      expect(after.error).toMatch(/will retry/)

      // A transient tool failure must never purge a good download's files.
      await expect(access(join(musicDirTmp, rel))).resolves.toBeUndefined()
    })
  })

  describe('mergeDownloadedRelease: provenance stamping', () => {
    let musicDirTmp: string
    let readyRootTmp: string

    beforeEach(async () => {
      musicDirTmp = await mkdtemp(join(tmpdir(), 'dmp-music-'))
      readyRootTmp = await mkdtemp(join(tmpdir(), 'dmp-ready-'))
      process.env.MUSIC_DIR = musicDirTmp
      await prisma.settings.upsert({
        where: { id: 'main' },
        create: { id: 'main', downloadsPath: readyRootTmp },
        update: { downloadsPath: readyRootTmp },
      })
      execFileMock.mockReset()
      execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: (e: Error | null, o: string, err: string) => void) => cb(null, '', ''))
    })

    afterEach(async () => {
      process.env.MUSIC_DIR = ''
      await rm(musicDirTmp, { recursive: true, force: true })
      await rm(readyRootTmp, { recursive: true, force: true })
    })

    it('stamps downloadedFrom as "rutracker" (not hardcoded "slskd") for a RUTRACKER-sourced merge', async () => {
      const { mergeDownloadedRelease } = await import('../../../server/utils/promote')

      const rel = 'Some Artist/2020 - RT Album'
      const stagingPath = join(readyRootTmp, '_ready', rel)
      await mkdir(stagingPath, { recursive: true })
      await writeFile(join(stagingPath, 'track.flac'), 'fake-audio')

      const mbRelease = await makeMbRelease(prisma, { status: 'COMPLETE' })
      const dl = await makeDownloadedRelease(prisma, {
        status: 'READY', stagingPath, title: 'RT Album', source: 'RUTRACKER',
      })
      // Stand-in for what a real (mocked-away) `sync --release` run would have bound.
      await makeLocalRelease(prisma, {
        folderPath: rel, matchStatus: 'COMPLETE', releaseId: mbRelease.id,
      })

      const { localReleaseId } = await mergeDownloadedRelease(dl.id)

      expect(localReleaseId).not.toBeNull()
      const lr = await prisma.localRelease.findUniqueOrThrow({ where: { id: localReleaseId! } })
      expect(lr.downloadedFrom).toBe('rutracker')
    })

    it('passes the download\'s artistId as --artist-hint to sync --release, so a collab release validates under the artist it was downloaded for', async () => {
      const { mergeDownloadedRelease } = await import('../../../server/utils/promote')

      const rel = 'Some Artist/2020 - Collab Album'
      const stagingPath = join(readyRootTmp, '_ready', rel)
      await mkdir(stagingPath, { recursive: true })
      await writeFile(join(stagingPath, 'track.flac'), 'fake-audio')

      const artist = await makeArtist(prisma)
      const dl = await makeDownloadedRelease(prisma, {
        status: 'READY', stagingPath, title: 'Collab Album', artistId: artist.id,
      })
      await makeLocalRelease(prisma, { folderPath: rel, matchStatus: 'UNMATCHED', releaseId: null })

      await mergeDownloadedRelease(dl.id)

      const syncCall = execFileMock.mock.calls.find(c => (c[1] as string[]).includes('--release'))
      expect(syncCall?.[1]).toEqual(expect.arrayContaining(['--artist-hint', artist.id]))
    })

    it('omits --artist-hint when the download has no artistId', async () => {
      const { mergeDownloadedRelease } = await import('../../../server/utils/promote')

      const rel = 'Some Artist/2020 - No Artist Id'
      const stagingPath = join(readyRootTmp, '_ready', rel)
      await mkdir(stagingPath, { recursive: true })
      await writeFile(join(stagingPath, 'track.flac'), 'fake-audio')

      const dl = await makeDownloadedRelease(prisma, {
        status: 'READY', stagingPath, title: 'No Artist Id', artistId: null,
      })
      await makeLocalRelease(prisma, { folderPath: rel, matchStatus: 'UNMATCHED', releaseId: null })

      await mergeDownloadedRelease(dl.id)

      const syncCall = execFileMock.mock.calls.find(c => (c[1] as string[]).includes('--release'))
      expect(syncCall?.[1]).not.toContain('--artist-hint')
    })
  })

  describe('mergeDownloadedRelease: completeness gate (audit items 1, 6, 7)', () => {
    let musicDirTmp: string
    let readyRootTmp: string

    beforeEach(async () => {
      musicDirTmp = await mkdtemp(join(tmpdir(), 'dmp-music-'))
      readyRootTmp = await mkdtemp(join(tmpdir(), 'dmp-ready-'))
      process.env.MUSIC_DIR = musicDirTmp
      await prisma.settings.upsert({
        where: { id: 'main' },
        create: { id: 'main', downloadsPath: readyRootTmp },
        update: { downloadsPath: readyRootTmp },
      })
      execFileMock.mockReset()
      execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: (e: Error | null, o: string, err: string) => void) => cb(null, '', ''))
    })

    afterEach(async () => {
      process.env.MUSIC_DIR = ''
      await rm(musicDirTmp, { recursive: true, force: true })
      await rm(readyRootTmp, { recursive: true, force: true })
    })

    it('COMPLETE (exact match): PROMOTED, and the MISSING placeholder it was downloaded against is retired so it stops being re-downloaded', async () => {
      const { mergeDownloadedRelease } = await import('../../../server/utils/promote')

      const rel = 'Some Artist/2020 - Complete Album'
      const stagingPath = join(readyRootTmp, '_ready', rel)
      await mkdir(stagingPath, { recursive: true })
      await writeFile(join(stagingPath, 'track.flac'), 'fake-audio')

      const rgId = `rg-complete-${randomUUID()}`
      const boundMb = await makeMbRelease(prisma, { status: 'COMPLETE', releaseGroupId: rgId })
      const placeholder = await makeMbRelease(prisma, { status: 'MISSING', releaseGroupId: rgId })
      const otherRgPlaceholder = await makeMbRelease(prisma, { status: 'MISSING' }) // unrelated group — must survive
      const lr = await makeLocalRelease(prisma, {
        folderPath: rel, matchStatus: 'COMPLETE', releaseId: boundMb.id,
      })
      const dl = await makeDownloadedRelease(prisma, {
        status: 'READY', stagingPath, title: 'Complete Album', releaseGroupId: rgId,
      })

      const { localReleaseId, error } = await mergeDownloadedRelease(dl.id)

      expect(error).toBeNull()
      expect(localReleaseId).toBe(lr.id)
      const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl.id } })
      expect(after.status).toBe('PROMOTED')
      expect(after.localReleaseId).toBe(lr.id)

      expect(await prisma.musicBrainzRelease.findUnique({ where: { id: placeholder.id } })).toBeNull()
      expect(await prisma.musicBrainzRelease.findUnique({ where: { id: otherRgPlaceholder.id } })).not.toBeNull()
    })

    it('MISSING_TRACKS (genuine shortfall): purges the folder, deletes the LocalRelease, lands INVALID, and leaves the MISSING placeholder alone', async () => {
      const { mergeDownloadedRelease } = await import('../../../server/utils/promote')

      const rel = 'Some Artist/2020 - Shortfall Album'
      const stagingPath = join(readyRootTmp, '_ready', rel)
      await mkdir(stagingPath, { recursive: true })
      await writeFile(join(stagingPath, 'track.flac'), 'fake-audio')

      const rgId = `rg-shortfall-${randomUUID()}`
      const boundMb = await makeMbRelease(prisma, { status: 'MISSING_TRACKS', releaseGroupId: rgId })
      const placeholder = await makeMbRelease(prisma, { status: 'MISSING', releaseGroupId: rgId })
      const lr = await makeLocalRelease(prisma, {
        folderPath: rel, matchStatus: 'MISSING_TRACKS', releaseId: boundMb.id,
      })
      const dl = await makeDownloadedRelease(prisma, {
        status: 'READY', stagingPath, title: 'Shortfall Album', releaseGroupId: rgId, attempts: 0,
      })

      const { localReleaseId, error } = await mergeDownloadedRelease(dl.id)

      expect(localReleaseId).toBeNull()
      expect(error).toMatch(/incomplete/)
      expect(await prisma.localRelease.findUnique({ where: { id: lr.id } })).toBeNull()
      await expect(access(join(musicDirTmp, rel))).rejects.toThrow()

      const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl.id } })
      expect(after.status).toBe('INVALID')
      expect(after.attempts).toBe(1)

      // The MISSING placeholder is deliberately kept — this release is still worth re-downloading.
      expect(await prisma.musicBrainzRelease.findUnique({ where: { id: placeholder.id } })).not.toBeNull()

      // The matched-but-shortfall edition itself must not survive as an orphan (the MOON bug: a
      // permanently phantom "MISSING_TRACKS" edition next to the retryable placeholder).
      expect(await prisma.musicBrainzRelease.findUnique({ where: { id: boundMb.id } })).toBeNull()
    })

    it('MISSING_TRACKS discard: keeps the matched MusicBrainzRelease when another LocalRelease still points at it (duplicate-copy case)', async () => {
      const { mergeDownloadedRelease } = await import('../../../server/utils/promote')

      const rel = 'Some Artist/2020 - Shared Edition Album'
      const stagingPath = join(readyRootTmp, '_ready', rel)
      await mkdir(stagingPath, { recursive: true })
      await writeFile(join(stagingPath, 'track.flac'), 'fake-audio')

      const rgId = `rg-shared-${randomUUID()}`
      const boundMb = await makeMbRelease(prisma, { status: 'MISSING_TRACKS', releaseGroupId: rgId })
      // A pre-existing local copy already bound to the same edition — the merge below must not
      // delete it out from under that other LocalRelease.
      await makeLocalRelease(prisma, { matchStatus: 'MISSING_TRACKS', releaseId: boundMb.id })
      const lr = await makeLocalRelease(prisma, { folderPath: rel, matchStatus: 'MISSING_TRACKS', releaseId: boundMb.id })
      const dl = await makeDownloadedRelease(prisma, {
        status: 'READY', stagingPath, title: 'Shared Edition Album', releaseGroupId: rgId, attempts: 0,
      })

      await mergeDownloadedRelease(dl.id)

      expect(await prisma.localRelease.findUnique({ where: { id: lr.id } })).toBeNull()
      expect(await prisma.musicBrainzRelease.findUnique({ where: { id: boundMb.id } })).not.toBeNull()
    })

    it('MISSING_TRACKS discard: keeps the matched MusicBrainzRelease when an owned-bundle LocalReleaseTrack.mbTrackId still points at one of its tracks', async () => {
      const { mergeDownloadedRelease } = await import('../../../server/utils/promote')

      const rel = 'Some Artist/2020 - Bonus Disc Album'
      const stagingPath = join(readyRootTmp, '_ready', rel)
      await mkdir(stagingPath, { recursive: true })
      await writeFile(join(stagingPath, 'track.flac'), 'fake-audio')

      const rgId = `rg-bonus-${randomUUID()}`
      const boundMb = await makeMbRelease(prisma, { status: 'MISSING_TRACKS', releaseGroupId: rgId })
      const mbTrack = await makeMbTrack(prisma, boundMb.id)
      // Stand-in for scripts/sync/src/owned.rs::claim_owned_bundle: a bonus-disc track linked via
      // LocalReleaseTrack.mbTrackId while LocalRelease.releaseId points at a different container.
      const container = await makeLocalRelease(prisma, { matchStatus: 'COMPLETE' })
      await makeLocalTrack(prisma, { localReleaseId: container.id, mbTrackId: mbTrack.id })
      const lr = await makeLocalRelease(prisma, { folderPath: rel, matchStatus: 'MISSING_TRACKS', releaseId: boundMb.id })
      const dl = await makeDownloadedRelease(prisma, {
        status: 'READY', stagingPath, title: 'Bonus Disc Album', releaseGroupId: rgId, attempts: 0,
      })

      await mergeDownloadedRelease(dl.id)

      expect(await prisma.localRelease.findUnique({ where: { id: lr.id } })).toBeNull()
      expect(await prisma.musicBrainzRelease.findUnique({ where: { id: boundMb.id } })).not.toBeNull()
    })

    it('EXTRA_TRACKS (deluxe/superset copy): kept and PROMOTED, not purged — and the MISSING placeholder IS retired', async () => {
      const { mergeDownloadedRelease } = await import('../../../server/utils/promote')

      const rel = 'Some Artist/2020 - Deluxe Album'
      const stagingPath = join(readyRootTmp, '_ready', rel)
      await mkdir(stagingPath, { recursive: true })
      await writeFile(join(stagingPath, 'track.flac'), 'fake-audio')

      const rgId = `rg-deluxe-${randomUUID()}`
      const boundMb = await makeMbRelease(prisma, { status: 'EXTRA_TRACKS', releaseGroupId: rgId })
      const placeholder = await makeMbRelease(prisma, { status: 'MISSING', releaseGroupId: rgId })
      const lr = await makeLocalRelease(prisma, {
        folderPath: rel, matchStatus: 'EXTRA_TRACKS', releaseId: boundMb.id,
      })
      const dl = await makeDownloadedRelease(prisma, {
        status: 'READY', stagingPath, title: 'Deluxe Album', releaseGroupId: rgId, attempts: 0,
      })

      const { localReleaseId, error } = await mergeDownloadedRelease(dl.id)

      expect(error).toBeNull()
      expect(localReleaseId).toBe(lr.id)
      // Files stay on disk — never purged for a superset copy.
      await expect(access(join(musicDirTmp, rel))).resolves.toBeUndefined()

      const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl.id } })
      expect(after.status).toBe('PROMOTED')
      expect(after.localReleaseId).toBe(lr.id)

      // Fulfilled (even by a superset copy) — the placeholder must stop being re-downloaded.
      expect(await prisma.musicBrainzRelease.findUnique({ where: { id: placeholder.id } })).toBeNull()
    })

    it('P2002 duplicate localReleaseId (audit item 8): a second row resolving to an already-owned LocalRelease is PROMOTED without the link, not thrown', async () => {
      const { mergeDownloadedRelease } = await import('../../../server/utils/promote')

      const rel = 'Some Artist/2020 - Already Owned Album'
      const stagingPath = join(readyRootTmp, '_ready', rel)
      await mkdir(stagingPath, { recursive: true })
      await writeFile(join(stagingPath, 'track.flac'), 'fake-audio')

      const mb = await makeMbRelease(prisma, { status: 'COMPLETE' })
      const lr = await makeLocalRelease(prisma, { folderPath: rel, matchStatus: 'COMPLETE', releaseId: mb.id })
      // dl1 already owns this LocalRelease (a prior successful merge).
      const dl1 = await makeDownloadedRelease(prisma, {
        status: 'PROMOTED', stagingPath: join(musicDirTmp, rel), title: 'Already Owned Album', localReleaseId: lr.id,
      })
      // dl2 is a second row (duplicate download / re-merge) whose folderPath resolves to the SAME lr.
      const dl2 = await makeDownloadedRelease(prisma, {
        status: 'READY', stagingPath, title: 'Already Owned Album',
      })

      const { localReleaseId, error } = await mergeDownloadedRelease(dl2.id)

      expect(error).toBeNull()
      expect(localReleaseId).toBe(lr.id) // reports the LocalRelease it resolved to, even though unlinked

      const dl2After = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl2.id } })
      expect(dl2After.status).toBe('PROMOTED')
      expect(dl2After.localReleaseId).toBeNull() // never linked — dl1 already holds the unique FK

      const dl1After = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl1.id } })
      expect(dl1After.localReleaseId).toBe(lr.id) // untouched
    })
  })

  describe('mergeDownloadedRelease: folderPath matching must not cross into a sibling release', () => {
    let musicDirTmp: string
    let readyRootTmp: string

    beforeEach(async () => {
      musicDirTmp = await mkdtemp(join(tmpdir(), 'dmp-music-'))
      readyRootTmp = await mkdtemp(join(tmpdir(), 'dmp-ready-'))
      process.env.MUSIC_DIR = musicDirTmp
      await prisma.settings.upsert({
        where: { id: 'main' },
        create: { id: 'main', downloadsPath: readyRootTmp },
        update: { downloadsPath: readyRootTmp },
      })
      execFileMock.mockReset()
      execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: (e: Error | null, o: string, err: string) => void) => cb(null, '', ''))
    })

    afterEach(async () => {
      process.env.MUSIC_DIR = ''
      await rm(musicDirTmp, { recursive: true, force: true })
      await rm(readyRootTmp, { recursive: true, force: true })
    })

    it('picks the exact-folderPath LocalRelease, never a "(Deluxe)" sibling that merely starts with the same prefix', async () => {
      const { mergeDownloadedRelease } = await import('../../../server/utils/promote')

      const rel = 'Some Artist/2001 - Album'
      const stagingPath = join(readyRootTmp, '_ready', rel)
      await mkdir(stagingPath, { recursive: true })
      await writeFile(join(stagingPath, 'track.flac'), 'fake-audio')

      const realMb = await makeMbRelease(prisma, { status: 'COMPLETE' })
      const decoyMb = await makeMbRelease(prisma, { status: 'COMPLETE' })

      // Decoy is a genuinely different release that merely shares the prefix, created AFTER the real
      // one - under the old `startsWith(stripped)` + `orderBy createdAt desc` query this would win.
      const real = await makeLocalRelease(prisma, {
        folderPath: rel, matchStatus: 'COMPLETE', releaseId: realMb.id,
      })
      await makeLocalRelease(prisma, {
        folderPath: `${rel} (Deluxe)`, matchStatus: 'COMPLETE', releaseId: decoyMb.id,
      })

      const dl = await makeDownloadedRelease(prisma, { status: 'READY', stagingPath, title: 'Album' })

      const { localReleaseId } = await mergeDownloadedRelease(dl.id)

      expect(localReleaseId).toBe(real.id)
    })
  })

  describe('mergeDownloadedRelease: status guard + concurrency claim (audit item 4)', () => {
    let musicDirTmp: string
    let readyRootTmp: string

    beforeEach(async () => {
      musicDirTmp = await mkdtemp(join(tmpdir(), 'dmp-music-'))
      readyRootTmp = await mkdtemp(join(tmpdir(), 'dmp-ready-'))
      process.env.MUSIC_DIR = musicDirTmp
      await prisma.settings.upsert({
        where: { id: 'main' },
        create: { id: 'main', downloadsPath: readyRootTmp },
        update: { downloadsPath: readyRootTmp },
      })
      execFileMock.mockReset()
      execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: (e: Error | null, o: string, err: string) => void) => cb(null, '', ''))
    })

    afterEach(async () => {
      process.env.MUSIC_DIR = ''
      await rm(musicDirTmp, { recursive: true, force: true })
      await rm(readyRootTmp, { recursive: true, force: true })
    })

    it('refuses to merge a row that is not READY (e.g. already PROMOTED)', async () => {
      const { mergeDownloadedRelease } = await import('../../../server/utils/promote')
      const dl = await makeDownloadedRelease(prisma, { status: 'PROMOTED', stagingPath: '/some/path' })

      await expect(mergeDownloadedRelease(dl.id)).rejects.toMatchObject({ statusCode: 409 })
      expect(execFileMock).not.toHaveBeenCalled()
    })

    it('a second concurrent merge of the same row is rejected with 409 instead of double-running index/sync', async () => {
      const { mergeDownloadedRelease } = await import('../../../server/utils/promote')

      const rel = 'Some Artist/2020 - Race Album'
      const stagingPath = join(readyRootTmp, '_ready', rel)
      await mkdir(stagingPath, { recursive: true })
      await writeFile(join(stagingPath, 'track.flac'), 'fake-audio')
      const dl = await makeDownloadedRelease(prisma, { status: 'READY', stagingPath, title: 'Race Album' })
      await makeLocalRelease(prisma, { folderPath: rel, matchStatus: 'UNMATCHED', releaseId: null })

      // Hold the first merge mid-flight by making execFile (the index/sync step) never resolve until
      // we've asserted the race, so the second call lands while the first still holds the claim.
      let releaseFirst: () => void = () => {}
      const stall = new Promise<void>((resolve) => { releaseFirst = resolve })
      execFileMock.mockImplementation((_file: string, _args: string[], _opts: unknown, cb: (e: Error | null, o: string, err: string) => void) => {
        stall.then(() => cb(null, '', ''))
      })

      const first = mergeDownloadedRelease(dl.id)
      await new Promise(r => setTimeout(r, 10)) // let the first call claim the row and reach the stalled step
      await expect(mergeDownloadedRelease(dl.id)).rejects.toMatchObject({ statusCode: 409 })

      releaseFirst()
      await first
    })
  })

  describe('sweepDanglingDownloads', () => {
    it('deletes a terminal row once its release group is no longer MISSING (fulfilled or gone)', async () => {
      const { sweepDanglingDownloads } = await import('../../../server/utils/promote')
      const complete = await makeMbRelease(prisma, { releaseGroupId: 'rg-fulfilled', status: 'COMPLETE' })
      const dl = await makeDownloadedRelease(prisma, {
        status: 'UNAVAILABLE', mbReleaseId: 'dead-cuid', releaseGroupId: complete.releaseGroupId,
      })

      const { removed } = await sweepDanglingDownloads()

      expect(removed).toBe(1)
      expect(await prisma.downloadedRelease.findUnique({ where: { id: dl.id } })).toBeNull()
    })

    it('keeps a terminal row whose release group is still MISSING (still the dedup guard)', async () => {
      const { sweepDanglingDownloads } = await import('../../../server/utils/promote')
      const missing = await makeMbRelease(prisma, { releaseGroupId: 'rg-still-missing', status: 'MISSING' })
      const dl = await makeDownloadedRelease(prisma, {
        status: 'REJECTED', mbReleaseId: 'dead-cuid', releaseGroupId: missing.releaseGroupId,
      })

      const { removed } = await sweepDanglingDownloads()

      expect(removed).toBe(0)
      expect(await prisma.downloadedRelease.findUnique({ where: { id: dl.id } })).not.toBeNull()
    })

    it('never touches non-terminal rows (DOWNLOADING/ENRICHING/READY/PROMOTED)', async () => {
      const { sweepDanglingDownloads } = await import('../../../server/utils/promote')
      const complete = await makeMbRelease(prisma, { releaseGroupId: 'rg-inflight', status: 'COMPLETE' })
      const dl = await makeDownloadedRelease(prisma, {
        status: 'DOWNLOADING', mbReleaseId: 'some-id', releaseGroupId: complete.releaseGroupId,
      })

      const { removed } = await sweepDanglingDownloads()

      expect(removed).toBe(0)
      expect(await prisma.downloadedRelease.findUnique({ where: { id: dl.id } })).not.toBeNull()
    })

    it('legacy rows with no releaseGroupId fall back to matching by the (possibly dead) mbReleaseId', async () => {
      const { sweepDanglingDownloads } = await import('../../../server/utils/promote')
      const missing = await makeMbRelease(prisma, { releaseGroupId: null, status: 'MISSING' })
      const stillNeeded = await makeDownloadedRelease(prisma, {
        status: 'FAILED', mbReleaseId: missing.id, releaseGroupId: null,
      })
      const trulyDangling = await makeDownloadedRelease(prisma, {
        status: 'FAILED', mbReleaseId: 'no-such-release-anymore', releaseGroupId: null,
      })

      const { removed } = await sweepDanglingDownloads()

      expect(removed).toBe(1)
      expect(await prisma.downloadedRelease.findUnique({ where: { id: stillNeeded.id } })).not.toBeNull()
      expect(await prisma.downloadedRelease.findUnique({ where: { id: trulyDangling.id } })).toBeNull()
    })
  })
})
