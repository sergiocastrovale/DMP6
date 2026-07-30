import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeArtist, makeMbRelease, makeDownloadedRelease } from '../../../test/factories'

vi.mock('~/server/utils/acquire', () => ({
  findBestSlskdResult: vi.fn().mockResolvedValue(null),
  acquireRelease: vi.fn(),
}))
vi.mock('~/server/utils/acquireTorrent', () => ({
  acquireTorrentRelease: vi.fn().mockResolvedValue(null),
}))

const prisma = getTestPrisma()

describe('autoDownload.ts topUpDownloads (real Postgres): stable releaseGroupId dedup', () => {
  beforeEach(async () => {
    await resetDb()
    // topUpDownloads throttles itself via module-level state (lastTopUpAt/topUpRunning) that would
    // otherwise persist across tests/iterations in this file and silently no-op every call after the
    // first (within the same 60s search interval) — reset the module so each test gets a fresh worker.
    vi.resetModules()
    // Isolate the picker to Soulseek only, so source routing doesn't depend on RuTracker/Prowlarr.
    await prisma.downloadSourceConfig.update({ where: { name: 'RUTRACKER' }, data: { enabled: false } })
    await prisma.settings.upsert({
      where: { id: 'main' },
      create: { id: 'main', downloadsPath: '/tmp/dmp-test-downloads' },
      update: { downloadsPath: '/tmp/dmp-test-downloads' },
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it.each(['UNAVAILABLE', 'FAILED', 'INVALID'] as const)(
    'never creates a second %s row for a release whose MusicBrainzRelease id churned (delete+recreate), only reuses the existing row via releaseGroupId',
    async (retryStatus) => {
      const { topUpDownloads } = await import('../../../server/utils/autoDownload')

      const churnArtist = await makeArtist(prisma, { monitored: true })
      const freshArtist = await makeArtist(prisma, { monitored: true })

      const releaseGroupId = 'rg-stable-uuid'
      // The CURRENT MusicBrainzRelease row for the churned album — as if sync just deleted the old
      // placeholder and recreated it with a fresh cuid (mr.id), while releaseGroupId stayed the same.
      const currentMbRelease = await makeMbRelease(prisma, { releaseGroupId, status: 'MISSING' })
      await prisma.musicBrainzReleaseArtist.create({
        data: { releaseId: currentMbRelease.id, artistId: churnArtist.id },
      })
      // A DownloadedRelease row already exists from a previous cycle (e.g. INVALID: merged but failed
      // MB validation, per docs/downloader_issues.md #10) pointing at a now-dead mbReleaseId (the old
      // cuid) but carrying the SAME releaseGroupId.
      const existingRow = await makeDownloadedRelease(prisma, {
        artistId: churnArtist.id,
        mbReleaseId: 'dead-cuid-no-longer-exists',
        releaseGroupId,
        title: currentMbRelease.title,
        year: currentMbRelease.year,
        status: retryStatus,
        attempts: 1,
        priority: 5, // SLSK band, so RuTracker (disabled anyway) never contends for it
      })

      // An unrelated fresh MISSING release for a different artist, never attempted before — should still
      // be picked normally (proves the fix doesn't just suppress everything).
      const freshMbRelease = await makeMbRelease(prisma, { releaseGroupId: 'rg-fresh-uuid', status: 'MISSING' })
      await prisma.musicBrainzReleaseArtist.create({
        data: { releaseId: freshMbRelease.id, artistId: freshArtist.id },
      })

      await topUpDownloads()

      const churnRows = await prisma.downloadedRelease.findMany({ where: { artistId: churnArtist.id } })
      expect(churnRows).toHaveLength(1)
      expect(churnRows[0]!.id).toBe(existingRow.id)
      // Reused (not duplicated): mbReleaseId refreshed to the current cuid, attempts incremented once —
      // this is what makes the attempts cap durable (a never-matchable release eventually reaches
      // ABANDONED on THIS row instead of resetting to 0 on a fresh one every cycle).
      expect(churnRows[0]!.mbReleaseId).toBe(currentMbRelease.id)
      expect(churnRows[0]!.attempts).toBe(2)

      const freshRows = await prisma.downloadedRelease.findMany({ where: { artistId: freshArtist.id } })
      expect(freshRows).toHaveLength(1)
      expect(freshRows[0]!.mbReleaseId).toBe(freshMbRelease.id)
    },
  )

  it('a REJECTED/ABANDONED release is never resurrected by the trickle worker even after its MusicBrainzRelease id churns', async () => {
    for (const terminalStatus of ['REJECTED', 'ABANDONED'] as const) {
      vi.resetModules() // fresh topUpDownloads module per iteration — see beforeEach comment
      const { topUpDownloads } = await import('../../../server/utils/autoDownload')
      const artist = await makeArtist(prisma, { monitored: true })
      const releaseGroupId = `rg-${terminalStatus.toLowerCase()}`
      const currentMbRelease = await makeMbRelease(prisma, { releaseGroupId, status: 'MISSING' })
      await prisma.musicBrainzReleaseArtist.create({
        data: { releaseId: currentMbRelease.id, artistId: artist.id },
      })
      // The user rejected (or the cap abandoned) this release under an OLD, now-dead mbReleaseId; sync
      // has since deleted+recreated the MISSING placeholder with a fresh cuid.
      await makeDownloadedRelease(prisma, {
        artistId: artist.id,
        mbReleaseId: 'dead-cuid-no-longer-exists',
        releaseGroupId,
        title: currentMbRelease.title,
        year: currentMbRelease.year,
        status: terminalStatus,
        attempts: 3,
      })

      await topUpDownloads()

      const rows = await prisma.downloadedRelease.findMany({ where: { artistId: artist.id } })
      expect(rows, `${terminalStatus} row must not be duplicated/resurrected`).toHaveLength(1)
      expect(rows[0]!.status).toBe(terminalStatus)
      expect(rows[0]!.attempts).toBe(3)
    }
  })

  it('never picks a sibling MISSING edition of a release group already being acquired', async () => {
    const { topUpDownloads } = await import('../../../server/utils/autoDownload')

    const artist = await makeArtist(prisma, { monitored: true })
    const releaseGroupId = 'rg-shared-by-two-editions'
    // Two distinct MusicBrainzRelease editions (different ids/musicbrainzIds) of the SAME release group
    // — e.g. a regular vs. deluxe edition, both surfaced as MISSING.
    const editionA = await makeMbRelease(prisma, { releaseGroupId, status: 'MISSING', title: 'Album (Edition A)' })
    const editionB = await makeMbRelease(prisma, { releaseGroupId, status: 'MISSING', title: 'Album (Edition B)' })
    await prisma.musicBrainzReleaseArtist.createMany({
      data: [
        { releaseId: editionA.id, artistId: artist.id },
        { releaseId: editionB.id, artistId: artist.id },
      ],
    })
    // Edition A is already being acquired.
    await makeDownloadedRelease(prisma, {
      artistId: artist.id,
      mbReleaseId: editionA.id,
      releaseGroupId,
      title: editionA.title,
      year: editionA.year,
      status: 'DOWNLOADING',
    })

    await topUpDownloads()

    // pickFresh must not additionally grab Edition B — the group already has an active row.
    const rows = await prisma.downloadedRelease.findMany({ where: { artistId: artist.id } })
    expect(rows).toHaveLength(1)
    expect(rows[0]!.mbReleaseId).toBe(editionA.id)
  })

  it('creates no row at all when chooseSource has nothing eligible (both sources disabled)', async () => {
    const { topUpDownloads } = await import('../../../server/utils/autoDownload')

    await prisma.downloadSourceConfig.update({ where: { name: 'SLSKD' }, data: { enabled: false } })
    // RUTRACKER is already disabled in beforeEach — nothing can be picked, chooseSource always returns null.

    const artist = await makeArtist(prisma, { monitored: true })
    const mb = await makeMbRelease(prisma, { releaseGroupId: 'rg-no-source', status: 'MISSING' })
    await prisma.musicBrainzReleaseArtist.create({ data: { releaseId: mb.id, artistId: artist.id } })

    await topUpDownloads()

    const rows = await prisma.downloadedRelease.findMany({ where: { artistId: artist.id } })
    expect(rows).toHaveLength(0)
  })
})
