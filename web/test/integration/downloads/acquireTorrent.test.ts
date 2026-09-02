import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeArtist, makeMbRelease, makeDownloadedRelease } from '../../../test/factories'

vi.mock('~/server/utils/prowlarr', () => ({
  prowlarrSearch: vi.fn().mockResolvedValue([
    { title: 'Discography Pack', size: 1000, seeders: 5, leechers: 0, downloadUrl: 'magnet:fake', infoHash: null, indexer: 'RuTracker', format: 'FLAC' },
  ]),
}))
vi.mock('~/server/utils/qbittorrent', () => ({
  addTorrentPaused: vi.fn().mockResolvedValue('deadbeefcafe'),
  getTorrentFiles: vi.fn().mockResolvedValue([
    { index: 0, name: 'Trigger Album/01 Track.flac', size: 100, progress: 0, priority: 1 },
    { index: 1, name: 'Sibling Album/01 Track.flac', size: 100, progress: 0, priority: 1 },
  ]),
  setFilePriorities: vi.fn().mockResolvedValue(undefined),
  startTorrent: vi.fn().mockResolvedValue(undefined),
  deleteTorrent: vi.fn().mockResolvedValue(undefined),
}))

const prisma = getTestPrisma()

describe('acquireTorrentRelease: sibling dedup (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
    await prisma.settings.upsert({
      where: { id: 'main' },
      create: { id: 'main', qbittorrentUrl: 'http://fake', prowlarrUrl: 'http://fake', qbittorrentSavePath: '/fake/save' },
      update: { qbittorrentUrl: 'http://fake', prowlarrUrl: 'http://fake', qbittorrentSavePath: '/fake/save' },
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('does not re-fulfill a sibling album already being acquired under a since-churned mbReleaseId', async () => {
    const { acquireTorrentRelease } = await import('../../../server/utils/acquireTorrent')

    const artist = await makeArtist(prisma)
    const trigger = await makeMbRelease(prisma, { title: 'Trigger Album', status: 'MISSING' })
    const siblingGroupId = 'rg-sibling-shared'
    const sibling = await makeMbRelease(prisma, { title: 'Sibling Album', status: 'MISSING', releaseGroupId: siblingGroupId })
    await prisma.musicBrainzReleaseArtist.createMany({
      data: [
        { releaseId: trigger.id, artistId: artist.id },
        { releaseId: sibling.id, artistId: artist.id },
      ],
    })

    const triggerRow = await makeDownloadedRelease(prisma, {
      artistId: artist.id, mbReleaseId: trigger.id, title: trigger.title, year: trigger.year, status: 'DOWNLOADING',
    })
    // The sibling is ALREADY being acquired, but under an old mbReleaseId that has since churned —
    // only releaseGroupId still ties it back to the current `sibling` MB row.
    const siblingRow = await makeDownloadedRelease(prisma, {
      artistId: artist.id, mbReleaseId: 'dead-cuid-no-longer-exists', releaseGroupId: siblingGroupId,
      title: sibling.title, year: sibling.year, status: 'DOWNLOADING',
    })

    const result = await acquireTorrentRelease(
      { artistId: artist.id, artistName: artist.name, albumTitle: trigger.title, year: trigger.year, mbReleaseId: trigger.id, releaseGroupId: trigger.releaseGroupId },
      triggerRow.id,
    )

    expect(result).toEqual({ id: triggerRow.id })

    // Sibling must NOT be duplicated or re-created — the pre-existing row (old id) stays exactly as is.
    const siblingRows = await prisma.downloadedRelease.findMany({ where: { releaseGroupId: siblingGroupId } })
    expect(siblingRows).toHaveLength(1)
    expect(siblingRows[0]!.id).toBe(siblingRow.id)
    expect(siblingRows[0]!.mbReleaseId).toBe('dead-cuid-no-longer-exists') // untouched
  })

  it('does not re-fulfill a sibling album that is only SEARCHING (search in flight, no match confirmed yet)', async () => {
    const { acquireTorrentRelease } = await import('../../../server/utils/acquireTorrent')

    const artist = await makeArtist(prisma)
    const trigger = await makeMbRelease(prisma, { title: 'Trigger Album', status: 'MISSING' })
    const siblingGroupId = 'rg-sibling-searching'
    const sibling = await makeMbRelease(prisma, { title: 'Sibling Album', status: 'MISSING', releaseGroupId: siblingGroupId })
    await prisma.musicBrainzReleaseArtist.createMany({
      data: [
        { releaseId: trigger.id, artistId: artist.id },
        { releaseId: sibling.id, artistId: artist.id },
      ],
    })

    const triggerRow = await makeDownloadedRelease(prisma, {
      artistId: artist.id, mbReleaseId: trigger.id, title: trigger.title, year: trigger.year, status: 'DOWNLOADING',
    })
    const siblingRow = await makeDownloadedRelease(prisma, {
      artistId: artist.id, mbReleaseId: sibling.id, releaseGroupId: siblingGroupId,
      title: sibling.title, year: sibling.year, status: 'SEARCHING',
    })

    await acquireTorrentRelease(
      { artistId: artist.id, artistName: artist.name, albumTitle: trigger.title, year: trigger.year, mbReleaseId: trigger.id, releaseGroupId: trigger.releaseGroupId },
      triggerRow.id,
    )

    const siblingRows = await prisma.downloadedRelease.findMany({ where: { releaseGroupId: siblingGroupId } })
    expect(siblingRows).toHaveLength(1)
    expect(siblingRows[0]!.id).toBe(siblingRow.id)
    expect(siblingRows[0]!.status).toBe('SEARCHING') // untouched, not re-fulfilled
  })
})
