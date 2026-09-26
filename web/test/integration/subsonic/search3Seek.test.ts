import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { H3Event } from 'h3'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeUser } from '../../../test/factories'
import { search3 } from '../../../server/utils/subsonic/endpoints/search'
import { makeParams } from '../../../server/utils/subsonic/params'
import { subsonicSeeker } from '../../../server/utils/subsonic/seek'

const prisma = getTestPrisma()
const NO_EVENT = {} as H3Event

const songsAt = async (userId: number, offset: number, count: number): Promise<string[]> => {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  const res = await search3(NO_EVENT, { user: user as never, params: makeParams({ songOffset: offset, songCount: count, albumCount: 0, artistCount: 0 }), format: 'json' })
  return ((res.searchResult3 as { song: { id: string }[] }).song).map(s => s.id)
}

describe('search3 empty-query paging (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
    subsonicSeeker.reset()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('a full client sync returns every song exactly once, in id order, across checkpoint boundaries', async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "LocalReleaseTrack" (id, title, "filePath", "updatedAt")
      SELECT 'sg-' || lpad(g::text, 6, '0'), 'Song ' || g, '/m/sg-' || g || '.mp3', now() FROM generate_series(1, 25000) g`)
    const user = await makeUser(prisma)

    const seen: string[] = []
    for (let offset = 0; ; offset += 500) {
      const page = await songsAt(user.id, offset, 500)
      if (page.length === 0) {break}
      seen.push(...page)
    }

    const expected = (await prisma.localReleaseTrack.findMany({ orderBy: { id: 'asc' }, select: { id: true } })).map(r => r.id)
    expect(seen).toEqual(expected)
  }, 60_000)

  it('random jumps after a sync match a plain OFFSET query', async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "LocalReleaseTrack" (id, title, "filePath", "updatedAt")
      SELECT 'sj-' || lpad(g::text, 6, '0'), 'Song ' || g, '/m/sj-' || g || '.mp3', now() FROM generate_series(1, 24000) g`)
    const user = await makeUser(prisma)
    for (let offset = 0; offset < 24000; offset += 500) {await songsAt(user.id, offset, 500)}

    for (const offset of [0, 9999, 10_000, 10_001, 17_777, 23_900]) {
      const viaSeek = await songsAt(user.id, offset, 300)
      const viaOffset = (await prisma.localReleaseTrack.findMany({ orderBy: { id: 'asc' }, skip: offset, take: 300, select: { id: true } })).map(r => r.id)
      expect(viaSeek, `offset ${offset}`).toEqual(viaOffset)
    }
  }, 60_000)
})
