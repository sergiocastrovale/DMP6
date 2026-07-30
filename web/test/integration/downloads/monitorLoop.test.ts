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
