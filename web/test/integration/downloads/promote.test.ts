import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeDownloadedRelease } from '../../../test/factories'

const deleteTorrentMock = vi.fn().mockResolvedValue(undefined)
vi.mock('~/server/utils/qbittorrent', () => ({
  deleteTorrent: (...args: unknown[]) => deleteTorrentMock(...args),
}))
vi.mock('~/server/utils/slskd', () => ({
  getSlskdActiveDownloads: vi.fn().mockResolvedValue([]),
  cancelSlskdDownload: vi.fn().mockResolvedValue(undefined),
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

  it('moveToReady: a release with no MusicBrainz year is purged and marked FAILED (never promoted to _ready)', async () => {
    const { moveToReady } = await import('../../../server/utils/promote')
    const dl = await makeDownloadedRelease(prisma, {
      year: null,
      status: 'ENRICHING',
      stagingPath: '/tmp/dmp-test-nonexistent-staging',
    })
    await moveToReady(dl.id)
    const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: dl.id } })
    expect(after.status).toBe('FAILED')
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
})
