import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeArtist, makeDownloadedRelease } from '../../../test/factories'

vi.mock('~/server/utils/slskd', () => ({
  getSlskdActiveDownloads: vi.fn().mockResolvedValue([]),
  isSlskdTerminal: vi.fn().mockReturnValue(true),
  isSlskdFailed: vi.fn().mockReturnValue(false),
  cancelSlskdDownload: vi.fn().mockResolvedValue(undefined),
  relocateDownloadedFiles: vi.fn().mockResolvedValue({ targetDir: '/fake/target/dir', movedCount: 3 }),
  purgeDownloadedSourceFiles: vi.fn().mockResolvedValue(0),
}))
vi.mock('~/server/utils/layout', () => ({
  transformToLibraryLayout: vi.fn().mockResolvedValue('/fake/release/root'),
}))
vi.mock('~/server/utils/promote', () => ({
  moveToReady: vi.fn(async (id: string) => {
    const { getTestPrisma: getPrisma } = await import('../../../test/setup/db')
    await getPrisma().downloadedRelease.update({ where: { id }, data: { status: 'READY' } })
  }),
  mergeManyDownloadedReleases: vi.fn(),
}))
// resolveSongkongEnabled always true here — the point of this test is the BACKLOG gate, not the toggle.
vi.mock('~/server/utils/songkongSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../server/utils/songkongSettings')>()
  return { ...actual, resolveSongkongEnabled: vi.fn().mockResolvedValue(true) }
})

const prisma = getTestPrisma()

describe('monitorLoop.ts: SongKong backlog gate (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
    await prisma.settings.upsert({
      where: { id: 'main' },
      create: { id: 'main', downloadsPath: '/tmp/dmp-test-downloads' },
      update: { downloadsPath: '/tmp/dmp-test-downloads' },
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('a new completion skips ENRICHING and goes straight to READY once the drainer backlog is stale', async () => {
    const { reconcileDownloads } = await import('../../../server/utils/monitorLoop')

    const artist = await makeArtist(prisma)
    // Old ENRICHING backlog: past the 10min staleness threshold, no done/<id> marker will ever appear
    // (nothing drains it in this test) — this is what makes the drainer look stalled.
    await makeDownloadedRelease(prisma, {
      artistId: artist.id,
      status: 'ENRICHING',
      stagingPath: '/fake/stuck/staging',
      updatedAt: new Date(Date.now() - 20 * 60_000),
    })

    const fresh = await makeDownloadedRelease(prisma, {
      artistId: artist.id,
      status: 'DOWNLOADING',
      slskUsername: 'peer1',
      files: [{ filename: 'track01.flac', size: 123 }],
    })

    await reconcileDownloads()

    const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: fresh.id } })
    expect(after.status).not.toBe('ENRICHING')
    expect(after.status).toBe('READY')
  })
})
