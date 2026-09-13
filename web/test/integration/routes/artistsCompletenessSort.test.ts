import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'

// /api/artists sort=completeness builds this exact `orderBy` shape (server/api/artists/index.get.ts) -
// exercised directly against real Postgres because Prisma's `nulls` ordering is a DB-level
// behaviour, not something a JS-side unit test can fake.
const prisma = getTestPrisma()

describe('artists sort=completeness orderBy (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('sinks null completeness to the bottom regardless of direction', async () => {
    await prisma.artist.createMany({
      data: [
        { name: 'High', slug: 'high', completeness: 0.75 },
        { name: 'Unmatched', slug: 'unmatched', completeness: null },
        { name: 'Zero', slug: 'zero', completeness: 0 },
        { name: 'Low', slug: 'low', completeness: 0.29 },
      ],
    })

    const desc = await prisma.artist.findMany({
      orderBy: { completeness: { sort: 'desc', nulls: 'last' } },
      select: { slug: true },
    })
    expect(desc.map(a => a.slug)).toEqual(['high', 'low', 'zero', 'unmatched'])

    const asc = await prisma.artist.findMany({
      orderBy: { completeness: { sort: 'asc', nulls: 'last' } },
      select: { slug: true },
    })
    expect(asc.map(a => a.slug)).toEqual(['zero', 'low', 'high', 'unmatched'])
  })
})
