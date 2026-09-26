import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTestPrisma, resetDb } from '../../setup/db'
import { makeArtist, makeLocalRelease, makeLocalTrack, makeUser } from '../../factories'
import { artistListWhere, rankedArtistPage, releaseCountsByArtist, type ArtistListFilters } from '../../../server/utils/artistList'

vi.mock('../../../server/utils/images', () => ({
  verifyImage: (image: string | null, imageUrl: string | null) => ({ image, imageUrl }),
  primeImageExistence: async () => {},
}))

const prisma = getTestPrisma()

const noFilters: ArtistListFilters = { letter: null, search: null, genres: [], minCompleteness: null, maxCompleteness: null }

const own = (artistId: string, releases: number) => Promise.all(
  Array.from({ length: releases }, async () => {
    const r = await makeLocalRelease(prisma)
    await prisma.localReleaseArtist.create({ data: { artistId, localReleaseId: r.id } })
    return r
  }),
)

describe('browse artist list (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  const seed = async () => {
    const rock = await prisma.genre.create({ data: { name: 'rock' } })
    const jazz = await prisma.genre.create({ data: { name: 'jazz' } })
    const a = await makeArtist(prisma, { name: 'Alpha Band', slug: 'alpha-band', completeness: 0.9, genres: { connect: [{ id: rock.id }] } })
    const b = await makeArtist(prisma, { name: 'Beta 100%', slug: 'beta-100', completeness: 0.4, genres: { connect: [{ id: jazz.id }] } })
    const c = await makeArtist(prisma, { name: 'Gamma Ray', slug: 'gamma-ray', completeness: 0.1, genres: { connect: [{ id: rock.id }, { id: jazz.id }] } })
    const d = await makeArtist(prisma, { name: 'Delta (dup)', slug: 'delta', primaryArtistId: a.id })
    const e = await makeArtist(prisma, { name: 'Epsilon Added', slug: 'epsilon', manuallyAdded: true })
    const f = await makeArtist(prisma, { name: 'No Files', slug: 'no-files' })
    await own(a.id, 2)
    await own(b.id, 5)
    await own(c.id, 5)
    await own(d.id, 1)
    return { a, b, c, d, e, f }
  }

  const prismaIds = async (filters: ArtistListFilters) =>
    (await prisma.artist.findMany({ where: artistListWhere(filters), select: { id: true } })).map(r => r.id).sort()

  const sqlIds = async (filters: ArtistListFilters) =>
    (await rankedArtistPage(filters, 'releases', 'desc', 0, 0, 100)).ids.sort()

  it('the SQL conditions select exactly the artists the Prisma where does, for every filter', async () => {
    await seed()
    const cases: ArtistListFilters[] = [
      noFilters,
      { ...noFilters, letter: 'g' },
      { ...noFilters, search: 'ALPHA' },
      { ...noFilters, search: '100%' },
      { ...noFilters, genres: ['rock'] },
      { ...noFilters, genres: ['rock', 'jazz'] },
      { ...noFilters, genres: ['nope'] },
      { ...noFilters, minCompleteness: 0.3 },
      { ...noFilters, minCompleteness: 0.2, maxCompleteness: 0.5 },
      { ...noFilters, letter: 'a', genres: ['rock'], minCompleteness: 0.5 },
    ]
    for (const filters of cases) {
      expect(await sqlIds(filters), JSON.stringify(filters)).toEqual(await prismaIds(filters))
    }
  })

  it('browse hides connected duplicates and artists without files, but keeps manually added ones', async () => {
    const { a, b, c, e } = await seed()
    expect(await sqlIds(noFilters)).toEqual([a.id, b.id, c.id, e.id].sort())
  })

  it('sorts by release count in the database, ties by slug, in both directions', async () => {
    const { a, b, c, e } = await seed()

    const desc = await rankedArtistPage(noFilters, 'releases', 'desc', 0, 0, 100)
    // b and c both own 5 releases -> slug ascending; then a (2); manually added e owns none.
    expect(desc.ids).toEqual([b.id, c.id, a.id, e.id])
    expect(desc.total).toBe(4)

    const asc = await rankedArtistPage(noFilters, 'releases', 'asc', 0, 0, 100)
    expect(asc.ids).toEqual([e.id, a.id, b.id, c.id])
  })

  it('pages the ranking without changing the total', async () => {
    const { b, c, a } = await seed()

    const p1 = await rankedArtistPage(noFilters, 'releases', 'desc', 0, 0, 2)
    const p2 = await rankedArtistPage(noFilters, 'releases', 'desc', 0, 2, 2)

    expect(p1.ids).toEqual([b.id, c.id])
    expect(p2.ids).toEqual([a.id, expect.any(String)])
    expect(p1.total).toBe(4)
    expect(p2.total).toBe(4)
  })

  it('sorts by THIS user\'s play counts only', async () => {
    const { a, b, c } = await seed()
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    const play = async (userId: number, artistId: string, count: number) => {
      const link = await prisma.localReleaseArtist.findFirstOrThrow({ where: { artistId } })
      const track = await makeLocalTrack(prisma, { localReleaseId: link.localReleaseId })
      await prisma.localReleaseTrackPlay.create({ data: { userId, trackId: track.id, playCount: count, lastPlayedAt: new Date() } })
    }
    await play(alice.id, a.id, 9)
    await play(alice.id, c.id, 3)
    await play(bob.id, b.id, 100) // bob's plays must not leak into alice's order

    const aliceOrder = await rankedArtistPage(noFilters, 'playCount', 'desc', alice.id, 0, 100)
    expect(aliceOrder.ids.slice(0, 2)).toEqual([a.id, c.id])
    expect(aliceOrder.ids.indexOf(b.id)).toBeGreaterThan(1)

    const bobOrder = await rankedArtistPage(noFilters, 'playCount', 'desc', bob.id, 0, 100)
    expect(bobOrder.ids[0]).toBe(b.id)
  })

  it('counts releases per artist with one grouped query', async () => {
    const { a, b, e } = await seed()
    const counts = await releaseCountsByArtist([a.id, b.id, e.id])
    expect(counts.get(a.id)).toBe(2)
    expect(counts.get(b.id)).toBe(5)
    expect(counts.has(e.id)).toBe(false)
    expect((await releaseCountsByArtist([])).size).toBe(0)
  })
})
