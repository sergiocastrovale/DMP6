import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeLocalRelease, makeMbRelease } from '../../../test/factories'
import { fetchMosaicSources } from '../../../server/utils/mosaicSource'

const prisma = getTestPrisma()

describe('mosaic sources (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('takes one cover per MusicBrainz release, oldest folder first', async () => {
    const mb = await makeMbRelease(prisma)
    await makeLocalRelease(prisma, { releaseId: mb.id, image: 'newer.jpg', year: 2001, createdAt: new Date('2024-01-01') })
    await makeLocalRelease(prisma, { releaseId: mb.id, image: 'older.jpg', year: 2001, createdAt: new Date('2020-01-01') })

    expect((await fetchMosaicSources()).map(r => r.image)).toEqual(['older.jpg'])
  })

  it('keeps every unmatched release, skips releases without an image', async () => {
    await makeLocalRelease(prisma, { image: 'a.jpg', year: 1999 })
    await makeLocalRelease(prisma, { image: 'b.jpg', year: 2005 })
    await makeLocalRelease(prisma, { image: null })

    expect((await fetchMosaicSources()).map(r => r.image).sort()).toEqual(['a.jpg', 'b.jpg'])
  })
})
