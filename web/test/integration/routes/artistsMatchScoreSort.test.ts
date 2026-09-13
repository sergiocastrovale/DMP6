import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'

// /api/artists sort=score builds this exact `orderBy` shape (server/api/artists/index.get.ts) -
// exercised directly against real Postgres because Prisma's `nulls` ordering is a DB-level
// behaviour, not something a JS-side unit test can fake.
const prisma = getTestPrisma()

describe('artists sort=score orderBy (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('sinks null averageMatchScore to the bottom regardless of direction', async () => {
    await prisma.artist.createMany({
      data: [
        { name: 'High', slug: 'high', averageMatchScore: 0.75 },
        { name: 'Unmatched', slug: 'unmatched', averageMatchScore: null },
        { name: 'Zero', slug: 'zero', averageMatchScore: 0 },
        { name: 'Low', slug: 'low', averageMatchScore: 0.29 },
      ],
    })

    const desc = await prisma.artist.findMany({
      orderBy: { averageMatchScore: { sort: 'desc', nulls: 'last' } },
      select: { slug: true },
    })
    expect(desc.map(a => a.slug)).toEqual(['high', 'low', 'zero', 'unmatched'])

    const asc = await prisma.artist.findMany({
      orderBy: { averageMatchScore: { sort: 'asc', nulls: 'last' } },
      select: { slug: true },
    })
    expect(asc.map(a => a.slug)).toEqual(['zero', 'low', 'high', 'unmatched'])
  })
})
