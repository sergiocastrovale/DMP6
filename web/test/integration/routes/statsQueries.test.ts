import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../setup/db'
import { makeArtist, makeLocalRelease, makeLocalTrack, makeMbRelease } from '../../factories'
import { runStatQuery } from '../../../server/utils/statsQueries'

const prisma = getTestPrisma()

const args = (over: Partial<Parameters<typeof runStatQuery>[2]> = {}) => ({
  userId: null, search: '', skip: 0, pageSize: 50, page: 1, sort: '', order: 'asc' as const, ...over,
})

// The route returns one of many page shapes; each test states the one it expects.
const stat = async <T>(type: string, query: Record<string, unknown>, a: ReturnType<typeof args>): Promise<T> =>
  (await runStatQuery(type, query, a)) as unknown as T

const own = (artistId: string, localReleaseId: string) => prisma.localReleaseArtist.create({ data: { artistId, localReleaseId } })

describe('statistics detail queries (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  describe('size', () => {
    const seed = async () => {
      const big = await makeArtist(prisma, { name: 'Big', slug: 'big' })
      const small = await makeArtist(prisma, { name: 'Small', slug: 'small' })
      const dup = await makeArtist(prisma, { name: 'Big (dup)', slug: 'big-dup', primaryArtistId: big.id })
      const r1 = await makeLocalRelease(prisma, { totalFileSize: 500n })
      const r2 = await makeLocalRelease(prisma, { totalFileSize: 300n })
      const r3 = await makeLocalRelease(prisma, { totalFileSize: 50n })
      await makeLocalRelease(prisma, { totalFileSize: 0n }) // unowned/empty - ignored
      await own(big.id, r1.id)
      await own(dup.id, r1.id) // the SAME release owned by primary and duplicate: counted once
      await own(dup.id, r2.id)
      await own(small.id, r3.id)
      return { big, small, dup }
    }

    it('sums LocalRelease.totalFileSize per primary artist, rolling duplicates up without double counting', async () => {
      const { big, small } = await seed()

      const res = await stat<{ items: { id: string, totalSize: number }[], total: number }>('size', {}, args({ sort: 'totalSize', order: 'desc' }))

      expect(res.total).toBe(2)
      expect(res.items.map(i => [i.id, i.totalSize])).toEqual([[big.id, 800], [small.id, 50]])
    })

    it('orders by name, filters by search (escaped) and reports the filtered total', async () => {
      await seed()

      const byName = await stat<{ items: { name: string }[] }>('size', {}, args({ sort: 'name', order: 'asc' }))
      expect(byName.items.map(i => i.name)).toEqual(['Big', 'Small'])

      const searched = await stat<{ items: { name: string }[], total: number }>('size', {}, args({ search: 'sma' }))
      expect(searched.items.map(i => i.name)).toEqual(['Small'])
      expect(searched.total).toBe(1)
      const wildcard = await stat<{ total: number }>('size', {}, args({ search: '%' }))
      expect(wildcard.total).toBe(0)
    })

    it('reports the real total for a page past the end', async () => {
      await seed()
      const res = await stat<{ items: unknown[], total: number, hasMore: boolean }>('size', {}, args({ skip: 100, page: 3 }))
      expect(res.items).toEqual([])
      expect(res.total).toBe(2)
      expect(res.hasMore).toBe(false)
    })
  })

  describe('single-release', () => {
    it('lists primary artists owning exactly one release with its size and track count', async () => {
      const solo = await makeArtist(prisma, { name: 'Solo', slug: 'solo' })
      const prolific = await makeArtist(prisma, { name: 'Prolific', slug: 'prolific' })
      const dup = await makeArtist(prisma, { name: 'Solo (dup)', slug: 'solo-dup', primaryArtistId: solo.id })
      const only = await makeLocalRelease(prisma, { title: 'The Only One', totalFileSize: 700n })
      await own(solo.id, only.id)
      await own(dup.id, only.id)
      for (let i = 0; i < 2; i++) {
        const r = await makeLocalRelease(prisma)
        await own(prolific.id, r.id)
      }
      await makeLocalTrack(prisma, { localReleaseId: only.id })
      await makeLocalTrack(prisma, { localReleaseId: only.id })
      await makeLocalTrack(prisma, { localReleaseId: only.id })

      const res = await stat<{ items: Record<string, unknown>[], total: number }>('single-release', {}, args({ sort: 'trackCount', order: 'desc' }))

      expect(res.total).toBe(1)
      expect(res.items).toEqual([{ id: solo.id, name: 'Solo', slug: 'solo', releaseTitle: 'The Only One', trackCount: 3, totalSize: 700 }])
    })
  })

  describe('release types pivot and drill-down', () => {
    it('counts each artist\'s releases per bucket in one pass and reports the total', async () => {
      const artist = await makeArtist(prisma, { name: 'Pivot', slug: 'pivot' })
      const other = await makeArtist(prisma, { name: 'Other', slug: 'other' })
      const album = await makeMbRelease(prisma, { title: 'An Album' })
      const singleType = await prisma.releaseType.upsert({ where: { name: 'Single' }, create: { name: 'Single', slug: 'single' }, update: {} })
      const single = await makeMbRelease(prisma, { title: 'A Single', typeId: singleType.id })
      for (const [mb, who] of [[album, artist], [album, artist], [single, artist], [album, other]] as const) {
        const lr = await makeLocalRelease(prisma, { releaseId: mb.id, matchStatus: 'COMPLETE' })
        await own(who.id, lr.id)
      }

      const res = await stat<{ items: Record<string, unknown>[], total: number }>('types', {}, args({ sort: 'album', order: 'desc' }))

      expect(res.total).toBe(2)
      expect(res.items[0]).toMatchObject({ id: artist.id, album: 2, single: 1 })
      expect(res.items[1]).toMatchObject({ id: other.id, album: 1, single: 0 })
    })

    it('drills into one bucket for one artist, bound parameters and all', async () => {
      const artist = await makeArtist(prisma, { name: 'Drill', slug: 'drill' })
      const album = await makeMbRelease(prisma, { title: 'Deep Album' })
      const lr = await makeLocalRelease(prisma, { title: 'Deep Album', year: 1999, releaseId: album.id, matchStatus: 'COMPLETE' })
      await own(artist.id, lr.id)

      const res = await stat<{ items: unknown[], total: number }>('type-detail', { bucket: 'album', artist: 'drill' }, args({ search: "deep' OR 1=1 --" }))
      expect(res).toMatchObject({ items: [], total: 0 }) // the quote is data, not SQL

      const hit = await stat<{ items: { id: string, year: number }[], total: number }>('type-detail', { bucket: 'album', artist: 'drill' }, args({ search: 'deep' }))
      expect(hit.total).toBe(1)
      expect(hit.items[0]).toMatchObject({ id: lr.id, year: 1999 })
    })

    it('rejects an unknown bucket and an unknown artist', async () => {
      await expect(runStatQuery('type-detail', { bucket: 'nonsense', artist: 'x' }, args())).rejects.toMatchObject({ statusCode: 400 })
      await expect(runStatQuery('type-detail', { bucket: 'album', artist: 'missing' }, args())).rejects.toMatchObject({ statusCode: 404 })
    })
  })

  describe('tracks', () => {
    const titled = (title: string, artist = 'A') => makeLocalTrack(prisma, { title, artist })

    it('orders by title with the id as tiebreak, so duplicate titles never shuffle between pages', async () => {
      const dupes = await Promise.all([titled('Same'), titled('Same'), titled('Same'), titled('Same')])
      await titled('Alpha')
      await titled('Zulu')

      const all = await stat<{ items: { id: string, title: string }[] }>('tracks', {}, args({ pageSize: 10 }))
      expect(all.items.map(t => t.title)).toEqual(['Alpha', 'Same', 'Same', 'Same', 'Same', 'Zulu'])
      expect(all.items.slice(1, 5).map(t => t.id)).toEqual(dupes.map(t => t.id).sort())

      const paged = []
      for (let page = 1; page <= 3; page++) {
        const r = await stat<{ items: { id: string }[] }>('tracks', {}, args({ pageSize: 2, page, skip: (page - 1) * 2 }))
        paged.push(...r.items.map(t => t.id))
      }
      expect(paged).toEqual(all.items.map(t => t.id))
    })

    it('reverses with desc and sorts by artist', async () => {
      await titled('A1', 'Zed')
      await titled('B1', 'Amy')
      expect((await stat<{ items: { title: string }[] }>('tracks', {}, args({ order: 'desc' }))).items.map(t => t.title)).toEqual(['B1', 'A1'])
      expect((await stat<{ items: { title: string }[] }>('tracks', {}, args({ sort: 'artist' }))).items.map(t => t.title)).toEqual(['B1', 'A1'])
    })

    it('reports the stored library total when unfiltered, the real count when searching, and a real count before any scan', async () => {
      await titled('Find Me')
      await titled('Other')
      // No Statistics row yet: fall back to counting.
      expect((await stat<{ total: number }>('tracks', {}, args())).total).toBe(2)

      await prisma.statistics.upsert({ where: { id: 'main' }, create: { id: 'main', tracks: 2 }, update: { tracks: 2 } })
      const unfiltered = await stat<{ total: number, hasMore: boolean }>('tracks', {}, args({ pageSize: 1 }))
      expect(unfiltered).toMatchObject({ total: 2, hasMore: true })

      const searched = await stat<{ total: number, items: { title: string }[] }>('tracks', {}, args({ search: 'find' }))
      expect(searched.total).toBe(1)
      expect(searched.items.map(t => t.title)).toEqual(['Find Me'])
    })
  })
})
