import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../setup/db'
import { makeArtist, makeLocalRelease, makeLocalTrack, makeUser } from '../../factories'
import { fetchExplorePool } from '../../../server/utils/exploreCandidates'
import { EXPLORE_METADATA_KEYS } from '../../../server/utils/explore'
import { sampleIds, _resetSampleCacheForTest } from '../../../server/utils/randomSample'

const prisma = getTestPrisma()
const params = { energy: 5, era: 3, familiarity: 4, sound: 4 }

describe('Explore candidate pool (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
    _resetSampleCacheForTest()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('samples across the whole table, not just the first rows', async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "LocalReleaseTrack" (id, title, "filePath", year, "updatedAt")
      SELECT 'ex-' || lpad(g::text, 6, '0'), 'Song ' || g, '/m/ex-' || g || '.mp3', 1995, now()
      FROM generate_series(1, 20000) g`)
    await prisma.$executeRawUnsafe('ANALYZE "LocalReleaseTrack"')

    const seen = new Set<string>()
    for (let i = 0; i < 6; i++) {
      for (const id of await sampleIds(prisma, 'LocalReleaseTrack', 100)) {seen.add(id)}
    }

    // Six draws of 100 from 20k rows are all distinct-ish and not confined to the first 500 heap rows.
    expect(seen.size).toBeGreaterThan(300)
    const late = [...seen].filter(id => id > 'ex-010000')
    expect(late.length).toBeGreaterThan(50)
  })

  it('returns tracks with only the scorer\'s metadata keys, the release cover and the artist slug', async () => {
    const artist = await makeArtist(prisma, { name: 'Tester', slug: 'tester' })
    const release = await makeLocalRelease(prisma, { title: 'Album', image: 'cover.jpg' })
    await prisma.localReleaseArtist.create({ data: { localReleaseId: release.id, artistId: artist.id } })
    await makeLocalTrack(prisma, {
      title: 'Scored',
      year: 1995,
      genre: 'rock',
      localReleaseId: release.id,
      metadata: { IntegerBpm: '128', MOOD_HAPPY: '80', Composer: 'Someone', Lyrics: 'a very long text that must not be shipped' },
    })

    const pool = await fetchExplorePool({ userId: (await makeUser(prisma)).id, params, excludeIds: [] })

    expect(pool).toHaveLength(1)
    const t = pool[0]!
    expect(t.metadata).toEqual({ IntegerBpm: '128', MOOD_HAPPY: '80' })
    expect(t.localRelease?.image).toBe('cover.jpg')
    expect(t.localRelease?.artists[0]?.artist.slug).toBe('tester')
    expect(t.playCount).toBe(0)
    expect(EXPLORE_METADATA_KEYS).toContain('IntegerBpm')
  })

  it('applies the soft era filter, keeping tracks with no year', async () => {
    // era 3 = the 90s, soft range 1980-2009
    await makeLocalTrack(prisma, { title: 'In range', year: 1985 })
    await makeLocalTrack(prisma, { title: 'No year', year: null })
    await makeLocalTrack(prisma, { title: 'Too old', year: 1955 })
    await makeLocalTrack(prisma, { title: 'Too new', year: 2022 })

    const pool = await fetchExplorePool({ userId: (await makeUser(prisma)).id, params, excludeIds: [] })

    expect(pool.map(t => t.title).sort()).toEqual(['In range', 'No year'])
  })

  it('honours excludeIds and, for Uncharted, never offers a track the user has played', async () => {
    const user = await makeUser(prisma)
    const played = await makeLocalTrack(prisma, { title: 'Played', year: 1995 })
    const excluded = await makeLocalTrack(prisma, { title: 'Excluded', year: 1995 })
    const fresh = await makeLocalTrack(prisma, { title: 'Fresh', year: 1995 })
    await prisma.localReleaseTrackPlay.create({ data: { userId: user.id, trackId: played.id, playCount: 3, lastPlayedAt: new Date() } })

    const normal = await fetchExplorePool({ userId: user.id, params, excludeIds: [excluded.id] })
    expect(normal.map(t => t.id).sort()).toEqual([played.id, fresh.id].sort())
    expect(normal.find(t => t.id === played.id)?.playCount).toBe(3)

    const uncharted = await fetchExplorePool({ userId: user.id, params: { ...params, familiarity: 9 }, excludeIds: [excluded.id] })
    expect(uncharted.map(t => t.id)).toEqual([fresh.id])
  })

  it('returns an empty pool for an empty library', async () => {
    expect(await fetchExplorePool({ userId: (await makeUser(prisma)).id, params, excludeIds: [] })).toEqual([])
  })
})
