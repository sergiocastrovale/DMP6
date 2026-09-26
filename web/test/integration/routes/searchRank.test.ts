import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTestPrisma, resetDb } from '../../setup/db'
import { makeArtist, makeLocalRelease, makeLocalTrack, makeMbRelease } from '../../factories'
import { rankedArtistIds, rankedReleaseIds, rankedTrackIds } from '../../../server/utils/searchRank'

// verifyImage needs Nuxt's runtime config; this suite is about ranking and index use, not image files.
vi.mock('../../../server/utils/images', () => ({
  verifyImage: (image: string | null, imageUrl: string | null) => ({ image, imageUrl }),
}))

const prisma = getTestPrisma()

describe('search rankers (real Postgres, migrated schema)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('ranks exact, then prefix, then word-boundary, then substring', async () => {
    const substring = await makeLocalTrack(prisma, { title: 'Unloved Ones' })
    const word = await makeLocalTrack(prisma, { title: 'All You Need Is Love' })
    const prefix = await makeLocalTrack(prisma, { title: 'Love Will Tear Us Apart' })
    const exact = await makeLocalTrack(prisma, { title: 'love' })

    const { ids, total, totalCapped } = await rankedTrackIds('LOVE', 0, 10)

    expect(ids).toEqual([exact.id, prefix.id, word.id, substring.id])
    expect(total).toBe(4)
    expect(totalCapped).toBe(false)
  })

  it('matches LIKE metacharacters literally', async () => {
    const literal = await makeLocalTrack(prisma, { title: '100% Pure Love' })
    await makeLocalTrack(prisma, { title: '100 Pure Love' })
    await makeLocalTrack(prisma, { title: 'snake_case_song' })
    await makeLocalTrack(prisma, { title: 'snakeXcaseXsong' })

    expect((await rankedTrackIds('100% Pure', 0, 10)).ids).toEqual([literal.id])
    expect((await rankedTrackIds('e_case', 0, 10)).total).toBe(1)
  })

  it('pages the ranked list with skip/take and reports the same total on every page', async () => {
    for (let i = 0; i < 7; i++) {
      await makeLocalTrack(prisma, { title: `Paging Song ${i}` })
    }

    const first = await rankedTrackIds('paging song', 0, 3)
    const second = await rankedTrackIds('paging song', 3, 3)
    const beyond = await rankedTrackIds('paging song', 30, 3)

    expect(first.ids).toHaveLength(3)
    expect(second.ids).toHaveLength(3)
    expect(new Set([...first.ids, ...second.ids]).size).toBe(6)
    expect(first.total).toBe(7)
    expect(second.total).toBe(7)
    expect(beyond.ids).toEqual([])
    expect(beyond.total).toBe(7)
  })

  it('caps the reported total and flags it', async () => {
    await prisma.localReleaseTrack.createMany({
      data: Array.from({ length: 1005 }, (_, i) => ({ title: `Capped Anthem ${i}`, filePath: `/music/capped-${i}.mp3` })),
    })

    const { ids, total, totalCapped } = await rankedTrackIds('capped anthem', 0, 5)

    expect(ids).toHaveLength(5)
    expect(total).toBe(1000)
    expect(totalCapped).toBe(true)
  })

  it('requires 3 characters for tracks and releases, 2 for artists', async () => {
    await makeLocalTrack(prisma, { title: 'Ab Song' })
    await makeLocalRelease(prisma, { title: 'Ab Album' })
    await makeArtist(prisma, { name: 'Ab', slug: 'ab' })

    expect((await rankedTrackIds('ab', 0, 5)).ids).toEqual([])
    expect((await rankedReleaseIds('ab', 0, 5)).ids).toEqual([])
    expect((await rankedArtistIds('ab', 0, 5)).ids).toHaveLength(1)
  })

  it('finds a release through the MusicBrainz title it is bound to, once', async () => {
    const mb = await makeMbRelease(prisma, { title: 'Abbey Road (Remastered)' })
    const bound = await makeLocalRelease(prisma, { title: 'Abbey Road', releaseId: mb.id })
    const other = await makeLocalRelease(prisma, { title: 'Some Unrelated Folder', releaseId: mb.id })

    const { ids } = await rankedReleaseIds('remastered', 0, 10)

    expect(new Set(ids)).toEqual(new Set([bound.id, other.id]))
    expect(ids).toHaveLength(2)
  })

  it('hides connected (duplicate) artists and ranks by completeness inside a tier', async () => {
    const primary = await makeArtist(prisma, { name: 'Boards of Canada', slug: 'boc', completeness: 0.9 })
    const lesser = await makeArtist(prisma, { name: 'Boards of Canada Tribute', slug: 'boc-tribute', completeness: 0.2 })
    await makeArtist(prisma, { name: 'Boards of Canada', slug: 'boc-dup', primaryArtistId: primary.id })

    const { ids } = await rankedArtistIds('boards of canada', 0, 10)

    expect(ids).toEqual([primary.id, lesser.id])
  })

  it('every search branch can be served by a trigram index', async () => {
    // A small fixture table makes a sequential scan the cheaper plan, so this proves the index exists and
    // matches the ILIKE operator (the planner picks it once the real table is large) rather than that
    // the planner prefers it. Statistics are refreshed so the estimate isn't a default guess.
    await makeLocalTrack(prisma, { title: 'Needle In A Haystack' })
    await makeLocalRelease(prisma, { title: 'Needle Album' })
    await makeMbRelease(prisma, { title: 'Needle MB Release' })
    await makeArtist(prisma, { name: 'Needle Artist', slug: 'needle-artist' })
    await prisma.$executeRawUnsafe('ANALYZE')

    const cases: [string, string][] = [
      ['LocalReleaseTrack_title_trgm_idx', `SELECT id FROM "LocalReleaseTrack" WHERE title ILIKE '%haystack%'`],
      ['LocalReleaseTrack_lower_title_pattern_idx', `SELECT id FROM "LocalReleaseTrack" WHERE lower(title) = lower('needle in a haystack')`],
      ['LocalReleaseTrack_lower_title_pattern_idx', `SELECT id FROM "LocalReleaseTrack" WHERE lower(title) LIKE lower('needle') || '%'`],
      ['LocalRelease_title_trgm_idx', `SELECT id FROM "LocalRelease" WHERE title ILIKE '%needle%'`],
      ['MusicBrainzRelease_title_trgm_idx', `SELECT id FROM "MusicBrainzRelease" WHERE title ILIKE '%needle%'`],
      ['Artist_name_trgm_idx', `SELECT id FROM "Artist" WHERE name ILIKE '%needle%'`],
    ]
    for (const [index, sql] of cases) {
      const plan = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off')
        // Bitmap scans only: an unrelated btree (e.g. the track stats list's title index) can otherwise win on this
        // tiny table with a full index scan, which says nothing about whether the trigram index matches.
        await tx.$executeRawUnsafe('SET LOCAL enable_indexscan = off')
        await tx.$executeRawUnsafe('SET LOCAL enable_indexonlyscan = off')
        const rows = await tx.$queryRawUnsafe<Record<string, string>[]>(`EXPLAIN ${sql}`)
        return rows.map(r => r['QUERY PLAN']).join('\n')
      })
      expect(plan, sql).toContain(index)
    }
  })
})
