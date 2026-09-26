import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { H3Event } from 'h3'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeLocalRelease, makeLocalTrack, makeUser } from '../../../test/factories'
import { getAlbumList2, getRandomSongs } from '../../../server/utils/subsonic/endpoints/lists'
import { makeParams } from '../../../server/utils/subsonic/params'
import { _resetSampleCacheForTest } from '../../../server/utils/randomSample'
import type { HandlerContext } from '../../../server/utils/subsonic/types'

const prisma = getTestPrisma()
const NO_EVENT = {} as H3Event

const ctxFor = async (raw: Record<string, unknown>): Promise<HandlerContext> => {
  const u = await makeUser(prisma)
  return { user: u, params: makeParams(raw), format: 'json' }
}

const songIds = (res: Record<string, unknown>): string[] =>
  ((res.randomSongs as { song: { id: string }[] }).song).map(s => s.id)
const albumIds = (res: Record<string, unknown>): string[] =>
  ((res.albumList2 as { album: { id: string }[] }).album).map(a => a.id)

describe('Subsonic random lists (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
    _resetSampleCacheForTest()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('getRandomSongs draws from the whole library, not a fixed first-N subset', async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "LocalReleaseTrack" (id, title, "filePath", "updatedAt")
      SELECT 'rs-' || lpad(g::text, 6, '0'), 'Song ' || g, '/m/rs-' || g || '.mp3', now()
      FROM generate_series(1, 20000) g`)
    await prisma.$executeRawUnsafe('ANALYZE "LocalReleaseTrack"')

    const seen = new Set<string>()
    for (let i = 0; i < 8; i++) {
      for (const id of songIds(await getRandomSongs(NO_EVENT, await ctxFor({ size: 100 })))) {seen.add(id)}
    }

    expect(seen.size).toBeGreaterThan(400)
    // Old behaviour: only ids from the first 2000 rows. Now a healthy share come from beyond them.
    expect([...seen].filter(id => id > 'rs-002000').length).toBeGreaterThan(200)
  })

  it('getRandomSongs honours genre and year filters and returns at most size', async () => {
    await makeLocalTrack(prisma, { title: 'Match', genre: 'Jazz', year: 1960 })
    await makeLocalTrack(prisma, { title: 'Wrong genre', genre: 'Rock', year: 1960 })
    await makeLocalTrack(prisma, { title: 'Wrong year', genre: 'Jazz', year: 1990 })

    const res = await getRandomSongs(NO_EVENT, await ctxFor({ size: 10, genre: 'Jazz', fromYear: 1950, toYear: 1970 }))

    expect(songIds(res)).toHaveLength(1)
    expect(((res.randomSongs as { song: { title: string }[] }).song)[0]!.title).toBe('Match')
    expect(songIds(await getRandomSongs(NO_EVENT, await ctxFor({ size: 2 })))).toHaveLength(2)
  })

  it('getAlbumList2 type=random only offers albums that have tracks and ignores offset', async () => {
    const withTracks = await makeLocalRelease(prisma, { title: 'Has tracks' })
    await makeLocalTrack(prisma, { localReleaseId: withTracks.id })
    await makeLocalRelease(prisma, { title: 'Empty placeholder' })

    const res = await getAlbumList2(NO_EVENT, await ctxFor({ type: 'random', size: 10, offset: 500 }))

    expect(albumIds(res)).toEqual([withTracks.id])
  })
})
