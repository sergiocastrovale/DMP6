import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeArtist, makeDownloadedRelease } from '../../../test/factories'
import { songkongDirs, songkongMaxWaitMin } from '~/server/utils/songkongSettings'
import { transformToLibraryLayout } from '~/server/utils/layout'

const getSlskdActiveDownloadsMock = vi.fn().mockResolvedValue([])
vi.mock('~/server/utils/slskd', () => ({
  getSlskdActiveDownloads: (...args: unknown[]) => getSlskdActiveDownloadsMock(...args),
  isSlskdTerminal: vi.fn().mockReturnValue(true),
  isSlskdFailed: vi.fn().mockReturnValue(false),
  cancelSlskdDownload: vi.fn().mockResolvedValue(undefined),
  relocateDownloadedFiles: vi.fn().mockResolvedValue({ targetDir: '/fake/target/dir', movedCount: 3 }),
  purgeDownloadedSourceFiles: vi.fn().mockResolvedValue(0),
}))
vi.mock('~/server/utils/layout', () => ({
  transformToLibraryLayout: vi.fn().mockResolvedValue('/fake/release/root'),
}))
vi.mock('~/server/utils/songkongSettings', () => ({
  resolveSongkongEnabled: vi.fn().mockResolvedValue(false),
  songkongDirs: vi.fn().mockReturnValue({ spool: '/fake/spool', done: '/fake/done' }),
  songkongMaxWaitMin: vi.fn().mockReturnValue(60),
}))
const moveToReadyMock = vi.fn().mockRejectedValue(new Error('EACCES simulated'))
vi.mock('~/server/utils/promote', () => ({
  moveToReady: (...args: unknown[]) => moveToReadyMock(...args),
  mergeManyDownloadedReleases: vi.fn(),
}))
const getTorrentInfoMock = vi.fn()
const deleteTorrentMock = vi.fn().mockResolvedValue(undefined)
vi.mock('~/server/utils/qbittorrent', () => ({
  getTorrentInfo: (...args: unknown[]) => getTorrentInfoMock(...args),
  deleteTorrent: (...args: unknown[]) => deleteTorrentMock(...args),
  isQbitComplete: vi.fn().mockReturnValue(false),
  isQbitErrored: vi.fn().mockReturnValue(false),
}))

const prisma = getTestPrisma()

describe('monitorLoop.ts reconcileDownloads: settleFinished failure handling (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
    moveToReadyMock.mockClear()
    getSlskdActiveDownloadsMock.mockReset().mockResolvedValue([])
    await prisma.settings.upsert({
      where: { id: 'main' },
      create: { id: 'main', downloadsPath: '/tmp/dmp-test-downloads' },
      update: { downloadsPath: '/tmp/dmp-test-downloads' },
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('a moveToReady failure after a successful relocate does NOT strand the row DOWNLOADING — it goes FAILED with the good files still referenced (never purged)', async () => {
    const { reconcileDownloads } = await import('../../../server/utils/monitorLoop')

    const artist = await makeArtist(prisma)
    const dl = await makeDownloadedRelease(prisma, {
      artistId: artist.id,
      source: 'SLSKD',
      status: 'DOWNLOADING',
      slskUsername: 'peer1',
      files: [{ filename: 'track01.flac', size: 123 }],
      attempts: 0,
      priority: 10,
    })

    await reconcileDownloads()

    expect(moveToReadyMock).toHaveBeenCalledTimes(1)
    const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl.id } })
    expect(after.status).toBe('FAILED') // not left DOWNLOADING, not ABANDONED (attempts 0 -> 1, below default cap 3)
    expect(after.attempts).toBe(1)
    expect(after.error).toMatch(/move-to-ready failed/)
    // The relocated+transformed folder is real and good — it must stay referenced, never nulled/purged.
    expect(after.stagingPath).toBe('/fake/release/root')
  })

  it('a slskd fetch failure does NOT get treated as "no active transfers" — live DOWNLOADING rows are left untouched, not prematurely failed', async () => {
    const { reconcileDownloads } = await import('../../../server/utils/monitorLoop')
    getSlskdActiveDownloadsMock.mockReset().mockRejectedValue(new Error('ECONNREFUSED simulated'))

    const artist = await makeArtist(prisma)
    const dl = await makeDownloadedRelease(prisma, {
      artistId: artist.id,
      source: 'SLSKD',
      status: 'DOWNLOADING',
      slskUsername: 'peer1',
      files: [{ filename: 'track01.flac', size: 123 }],
      attempts: 0,
      priority: 10,
    })

    await reconcileDownloads()

    const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl.id } })
    expect(after.status).toBe('DOWNLOADING') // untouched — not FAILED/ABANDONED off a fetch error
    expect(after.attempts).toBe(0)
  })
})

describe('monitorLoop.ts reconcileTorrentDownloads: proportional byte-progress split (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
    getTorrentInfoMock.mockReset()
    deleteTorrentMock.mockClear()
    await prisma.settings.upsert({
      where: { id: 'main' },
      create: { id: 'main', downloadsPath: '/tmp/dmp-test-downloads' },
      update: { downloadsPath: '/tmp/dmp-test-downloads' },
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('splits the whole-torrent byte count proportionally across albums sharing one hash, instead of writing the same figure onto every row', async () => {
    const { reconcileTorrentDownloads } = await import('../../../server/utils/monitorLoop')

    const artist = await makeArtist(prisma)
    const hash = 'hash-pack-1'
    // Album A: 100 bytes of selected files (small); Album B: 900 bytes (big) -> 1000 in the pack.
    const a = await makeDownloadedRelease(prisma, {
      artistId: artist.id, source: 'RUTRACKER', status: 'DOWNLOADING', torrentHash: hash,
      files: [{ filename: 'a1.flac', size: 100 }], bytesTransferred: 0n,
    })
    const b = await makeDownloadedRelease(prisma, {
      artistId: artist.id, source: 'RUTRACKER', status: 'DOWNLOADING', torrentHash: hash,
      files: [{ filename: 'b1.flac', size: 900 }], bytesTransferred: 0n,
    })

    getTorrentInfoMock.mockResolvedValue([
      { hash, name: 'pack', state: 'downloading', progress: 0.5, size: 1000, completed: 0, downloaded: 500 },
    ])

    await reconcileTorrentDownloads()

    const afterA = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: a.id } })
    const afterB = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: b.id } })
    // 500 whole-pack bytes split 100:900 -> 50 and 450, NOT 500 written onto both (which would make
    // computeDownloadPercent divide 500 by each album's own tiny total and overshoot instantly).
    expect(Number(afterA.bytesTransferred)).toBe(50)
    expect(Number(afterB.bytesTransferred)).toBe(450)
  })

  it('fails a RUTRACKER row stuck DOWNLOADING with a null torrentHash once it is older than the orphan threshold (crashed before a hash was ever assigned)', async () => {
    const { reconcileTorrentDownloads } = await import('../../../server/utils/monitorLoop')

    const artist = await makeArtist(prisma)
    const old = new Date(Date.now() - 10 * 60_000) // 10 min ago, past the 3-min orphan threshold
    const orphan = await makeDownloadedRelease(prisma, {
      artistId: artist.id, source: 'RUTRACKER', status: 'DOWNLOADING', torrentHash: null,
      attempts: 0, priority: 10, updatedAt: old,
    })

    getTorrentInfoMock.mockResolvedValue([])

    await reconcileTorrentDownloads()

    const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: orphan.id } })
    expect(after.status).toBe('FAILED')
    expect(after.attempts).toBe(1)
    expect(after.error).toMatch(/torrent hash was ever assigned/)
  })

  it('leaves a fresh (just-created) hashless RUTRACKER row alone - not every null-hash row is an orphan yet', async () => {
    const { reconcileTorrentDownloads } = await import('../../../server/utils/monitorLoop')

    const artist = await makeArtist(prisma)
    const fresh = await makeDownloadedRelease(prisma, {
      artistId: artist.id, source: 'RUTRACKER', status: 'DOWNLOADING', torrentHash: null,
      attempts: 0, priority: 10,
    })

    getTorrentInfoMock.mockResolvedValue([])

    await reconcileTorrentDownloads()

    const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: fresh.id } })
    expect(after.status).toBe('DOWNLOADING')
    expect(after.attempts).toBe(0)
  })

  it('fails a RUTRACKER row stuck SEARCHING past the orphan threshold, same as a hashless DOWNLOADING row', async () => {
    const { reconcileTorrentDownloads } = await import('../../../server/utils/monitorLoop')

    const artist = await makeArtist(prisma)
    const old = new Date(Date.now() - 10 * 60_000) // 10 min ago, past the 3-min orphan threshold
    const orphan = await makeDownloadedRelease(prisma, {
      artistId: artist.id, source: 'RUTRACKER', status: 'SEARCHING', torrentHash: null,
      attempts: 0, priority: 10, updatedAt: old,
    })

    getTorrentInfoMock.mockResolvedValue([])

    await reconcileTorrentDownloads()

    const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: orphan.id } })
    expect(after.status).toBe('FAILED')
    expect(after.attempts).toBe(1)
  })
})

describe('monitorLoop.ts drainEnriching (via reconcileDownloads, audit item 9)', () => {
  let spoolDir: string
  let doneDir: string

  beforeEach(async () => {
    await resetDb()
    moveToReadyMock.mockReset().mockResolvedValue(undefined)
    getSlskdActiveDownloadsMock.mockReset().mockResolvedValue([])
    spoolDir = await mkdtemp(join(tmpdir(), 'dmp-drain-spool-'))
    doneDir = await mkdtemp(join(tmpdir(), 'dmp-drain-done-'))
    vi.mocked(songkongDirs).mockReturnValue({ root: spoolDir, spool: spoolDir, done: doneDir })
    vi.mocked(songkongMaxWaitMin).mockReturnValue(60)
    vi.mocked(transformToLibraryLayout).mockResolvedValue('/fake/release/root')
    await prisma.settings.upsert({
      where: { id: 'main' },
      create: { id: 'main', downloadsPath: '/tmp/dmp-test-downloads' },
      update: { downloadsPath: '/tmp/dmp-test-downloads' },
    })
  })

  afterEach(async () => {
    await rm(spoolDir, { recursive: true, force: true })
    await rm(doneDir, { recursive: true, force: true })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('done marker present: finalizes via settleFinished (moveToReady called) and cleans up the spool/done markers', async () => {
    const { reconcileDownloads } = await import('../../../server/utils/monitorLoop')

    const artist = await makeArtist(prisma)
    const dl = await makeDownloadedRelease(prisma, {
      artistId: artist.id, source: 'SLSKD', status: 'ENRICHING',
      stagingPath: '/fake/staged/dir', attempts: 0,
    })
    await writeFile(join(spoolDir, dl.id), `${dl.stagingPath}\n`)
    await writeFile(join(doneDir, dl.id), '')

    await reconcileDownloads()

    expect(moveToReadyMock).toHaveBeenCalledTimes(1)
    const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl.id } })
    expect(after.stagingPath).toBe('/fake/release/root')
    expect(after.error).toBeNull() // enriched cleanly — no timeout note
    await expect(access(join(spoolDir, dl.id))).rejects.toThrow()
    await expect(access(join(doneDir, dl.id))).rejects.toThrow()
  })

  it('no done marker past the max-wait window: promotes unenriched with a timeout note instead of stranding the row', async () => {
    const { reconcileDownloads } = await import('../../../server/utils/monitorLoop')
    vi.mocked(songkongMaxWaitMin).mockReturnValue(1) // 1 minute

    const artist = await makeArtist(prisma)
    const old = new Date(Date.now() - 10 * 60_000) // 10 min ago, past the 1-min max-wait
    const dl = await makeDownloadedRelease(prisma, {
      artistId: artist.id, source: 'SLSKD', status: 'ENRICHING',
      stagingPath: '/fake/staged/dir', attempts: 0, updatedAt: old,
    })
    // Deliberately no done marker written — this is the "drainer never finished" case.

    await reconcileDownloads()

    expect(moveToReadyMock).toHaveBeenCalledTimes(1)
    const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl.id } })
    expect(after.error).toMatch(/SongKong enrichment timed out/)
  })

  it('layout transform throws: routed through the attempts cap (FAILED), not left stuck ENRICHING forever', async () => {
    const { reconcileDownloads } = await import('../../../server/utils/monitorLoop')
    vi.mocked(transformToLibraryLayout).mockRejectedValueOnce(new Error('disk full simulated'))

    const artist = await makeArtist(prisma)
    const dl = await makeDownloadedRelease(prisma, {
      artistId: artist.id, source: 'SLSKD', status: 'ENRICHING',
      stagingPath: '/fake/staged/dir', attempts: 0,
    })
    await writeFile(join(spoolDir, dl.id), `${dl.stagingPath}\n`)
    await writeFile(join(doneDir, dl.id), '')

    await reconcileDownloads()

    const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl.id } })
    expect(after.status).toBe('FAILED') // not ABANDONED (attempts 0 -> 1, below default cap 3), not stuck ENRICHING
    expect(after.attempts).toBe(1)
    expect(after.error).toMatch(/layout transform failed/)
  })
})

describe('monitorLoop.ts reconcileDownloads/reconcileTorrentDownloads: transcode-failure gate (audit item 2/9)', () => {
  beforeEach(async () => {
    await resetDb()
    moveToReadyMock.mockReset().mockResolvedValue(undefined)
    getSlskdActiveDownloadsMock.mockReset().mockResolvedValue([])
    getTorrentInfoMock.mockReset()
    deleteTorrentMock.mockClear()
    await prisma.settings.upsert({
      where: { id: 'main' },
      create: { id: 'main', downloadsPath: '/tmp/dmp-test-downloads' },
      update: { downloadsPath: '/tmp/dmp-test-downloads' },
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('slskd path: a transcode failure fails the attempt instead of proceeding to ENRICHING/READY', async () => {
    const { relocateDownloadedFiles } = await import('~/server/utils/slskd')
    vi.mocked(relocateDownloadedFiles).mockResolvedValueOnce({ targetDir: '/fake/target/dir', movedCount: 3, transcodeFailed: 2 })
    const { reconcileDownloads } = await import('../../../server/utils/monitorLoop')

    const artist = await makeArtist(prisma)
    const dl = await makeDownloadedRelease(prisma, {
      artistId: artist.id, source: 'SLSKD', status: 'DOWNLOADING', slskUsername: 'peer1',
      files: [{ filename: 'track01.flac', size: 123 }], attempts: 0, priority: 10,
    })

    await reconcileDownloads()

    const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl.id } })
    expect(after.status).toBe('FAILED')
    expect(after.attempts).toBe(1)
    expect(after.error).toMatch(/failed to transcode/)
  })

  it('torrent path: a transcode failure fails the attempt instead of proceeding to ENRICHING/READY', async () => {
    const { relocateDownloadedFiles } = await import('~/server/utils/slskd')
    vi.mocked(relocateDownloadedFiles).mockResolvedValueOnce({ targetDir: '/fake/target/dir', movedCount: 1, transcodeFailed: 1 })
    const { reconcileTorrentDownloads } = await import('../../../server/utils/monitorLoop')

    const artist = await makeArtist(prisma)
    const hash = `hash-transcode-${artist.id}`
    const dl = await makeDownloadedRelease(prisma, {
      artistId: artist.id, source: 'RUTRACKER', status: 'DOWNLOADING', torrentHash: hash,
      torrentFolder: 'Some Folder', files: [{ filename: 'a1.flac', size: 100 }], attempts: 0,
    })

    getTorrentInfoMock.mockResolvedValue([
      { hash, name: 'pack', state: 'downloading', progress: 1, size: 100, completed: 100, downloaded: 100 },
    ])
    const { isQbitComplete } = await import('~/server/utils/qbittorrent')
    vi.mocked(isQbitComplete).mockReturnValueOnce(true)

    await reconcileTorrentDownloads()

    const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl.id } })
    expect(after.status).toBe('FAILED')
    expect(after.attempts).toBe(1)
    expect(after.error).toMatch(/failed to transcode/)
  })
})
