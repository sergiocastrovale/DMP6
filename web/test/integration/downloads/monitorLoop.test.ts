import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeArtist, makeDownloadedRelease } from '../../../test/factories'

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
})
