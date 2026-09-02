import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeArtist, makeMbRelease } from '../../../test/factories'

const prisma = getTestPrisma()

describe('countNoYearMissing (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('counts MISSING album/EP releases of monitored artists with no MusicBrainz year', async () => {
    const { countNoYearMissing } = await import('../../../server/utils/acquisitionStatus')

    const artist = await makeArtist(prisma, { monitored: true })
    const noYear = await makeMbRelease(prisma, { status: 'MISSING', year: null })
    await prisma.musicBrainzReleaseArtist.create({ data: { releaseId: noYear.id, artistId: artist.id } })

    expect(await countNoYearMissing()).toBe(1)
  })

  it('excludes releases that DO have a year, unmonitored artists, and non-MISSING releases', async () => {
    const { countNoYearMissing } = await import('../../../server/utils/acquisitionStatus')

    const monitored = await makeArtist(prisma, { monitored: true })
    const unmonitored = await makeArtist(prisma, { monitored: false })

    const hasYear = await makeMbRelease(prisma, { status: 'MISSING', year: 2020 })
    await prisma.musicBrainzReleaseArtist.create({ data: { releaseId: hasYear.id, artistId: monitored.id } })

    const complete = await makeMbRelease(prisma, { status: 'COMPLETE', year: null })
    await prisma.musicBrainzReleaseArtist.create({ data: { releaseId: complete.id, artistId: monitored.id } })

    const unmonitoredNoYear = await makeMbRelease(prisma, { status: 'MISSING', year: null })
    await prisma.musicBrainzReleaseArtist.create({ data: { releaseId: unmonitoredNoYear.id, artistId: unmonitored.id } })

    expect(await countNoYearMissing()).toBe(0)
  })
})
