import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeDownloadedRelease, makeMbRelease } from '../../../test/factories'

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
