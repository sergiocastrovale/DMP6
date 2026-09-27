import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeArtist, makeMbRelease } from '../../../test/factories'

const prisma = getTestPrisma()

describe('listNoYearMissing (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('lists MISSING album/EP releases of monitored artists with no MusicBrainz year', async () => {
    const { listNoYearMissing } = await import('../../../server/utils/acquisitionStatus')

    const artist = await makeArtist(prisma, { monitored: true, name: 'Solo Artist' })
    const noYear = await makeMbRelease(prisma, { status: 'MISSING', year: null, title: 'Untitled Release' })
    await prisma.musicBrainzReleaseArtist.create({ data: { releaseId: noYear.id, artistId: artist.id } })

    expect(await listNoYearMissing()).toEqual([{ artist: 'Solo Artist', title: 'Untitled Release' }])
  })

  it('excludes releases that DO have a year, unmonitored artists, and non-MISSING releases', async () => {
    const { listNoYearMissing } = await import('../../../server/utils/acquisitionStatus')

    const monitored = await makeArtist(prisma, { monitored: true })
    const unmonitored = await makeArtist(prisma, { monitored: false })

    const hasYear = await makeMbRelease(prisma, { status: 'MISSING', year: 2020 })
    await prisma.musicBrainzReleaseArtist.create({ data: { releaseId: hasYear.id, artistId: monitored.id } })

    const complete = await makeMbRelease(prisma, { status: 'COMPLETE', year: null })
    await prisma.musicBrainzReleaseArtist.create({ data: { releaseId: complete.id, artistId: monitored.id } })

    const unmonitoredNoYear = await makeMbRelease(prisma, { status: 'MISSING', year: null })
    await prisma.musicBrainzReleaseArtist.create({ data: { releaseId: unmonitoredNoYear.id, artistId: unmonitored.id } })

    expect(await listNoYearMissing()).toEqual([])
  })
})
