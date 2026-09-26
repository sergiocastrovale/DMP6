import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../setup/db'
import { makeArtist, makeLocalRelease, makeLocalTrack } from '../../factories'
import { listArtistTrackIds, randomArtistTrackIds } from '../../../server/utils/artistTracks'

const prisma = getTestPrisma()

describe('artist track ids (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  const seed = async () => {
    const artist = await makeArtist(prisma, { name: 'Owner', slug: 'owner' })
    const stranger = await makeArtist(prisma, { name: 'Stranger', slug: 'stranger' })

    const owned = await makeLocalRelease(prisma, { title: 'Owned' })
    await prisma.localReleaseArtist.create({ data: { artistId: artist.id, localReleaseId: owned.id } })
    const ownedTracks = [await makeLocalTrack(prisma, { localReleaseId: owned.id }), await makeLocalTrack(prisma, { localReleaseId: owned.id })]

    // A track on someone else's release that credits this artist ("appears on").
    const theirs = await makeLocalRelease(prisma, { title: 'Theirs' })
    await prisma.localReleaseArtist.create({ data: { artistId: stranger.id, localReleaseId: theirs.id } })
    const featured = await makeLocalTrack(prisma, { localReleaseId: theirs.id })
    await prisma.trackRelatedArtist.create({ data: { trackId: featured.id, artistId: artist.id } })
    await makeLocalTrack(prisma, { localReleaseId: theirs.id }) // unrelated, must not appear

    // Both an owned track AND credited - must not be listed twice.
    await prisma.trackRelatedArtist.create({ data: { trackId: ownedTracks[0]!.id, artistId: artist.id } })

    return { artist, ownedTracks, featured }
  }

  it('lists owned and credited tracks once each, and nothing else', async () => {
    const { artist, ownedTracks, featured } = await seed()

    const ids = await listArtistTrackIds(artist.id)

    expect(ids.sort()).toEqual([...ownedTracks.map(t => t.id), featured.id].sort())
  })

  it('returns a random subset of at most n of those tracks', async () => {
    const { artist, ownedTracks, featured } = await seed()
    const all = new Set([...ownedTracks.map(t => t.id), featured.id])

    const two = await randomArtistTrackIds(artist.id, 2)
    expect(two).toHaveLength(2)
    expect(two.every(id => all.has(id))).toBe(true)
    expect(await randomArtistTrackIds(artist.id, 50)).toHaveLength(3)
  })

  it('returns nothing for an artist with no tracks', async () => {
    const empty = await makeArtist(prisma, { name: 'Empty', slug: 'empty' })
    expect(await listArtistTrackIds(empty.id)).toEqual([])
    expect(await randomArtistTrackIds(empty.id, 5)).toEqual([])
  })

  it('never sequentially scans LocalReleaseTrack to find an artist\'s tracks', async () => {
    // Enough tracks that a sequential scan is the wrong plan; the artist owns ~50 of them.
    const artist = await makeArtist(prisma, { name: 'Needle', slug: 'needle' })
    const release = await makeLocalRelease(prisma, { title: 'Needle Album' })
    await prisma.localReleaseArtist.create({ data: { artistId: artist.id, localReleaseId: release.id } })
    await prisma.$executeRawUnsafe(`
      INSERT INTO "LocalReleaseTrack" (id, title, "filePath", "localReleaseId", "updatedAt")
      SELECT 'n-' || g, 'Needle ' || g, '/m/n-' || g || '.mp3', '${release.id}', now() FROM generate_series(1, 50) g`)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "LocalRelease" (id, title, "groupKey", "updatedAt")
      SELECT 'hay-' || g, 'Hay ' || g, 'hay-' || g, now() FROM generate_series(1, 2000) g`)
    await prisma.$executeRawUnsafe(`
      INSERT INTO "LocalReleaseTrack" (id, title, "filePath", "localReleaseId", "updatedAt")
      SELECT 'h-' || g, 'Hay ' || g, '/m/h-' || g || '.mp3', 'hay-' || (g % 2000 + 1), now() FROM generate_series(1, 40000) g`)
    await prisma.$executeRawUnsafe('ANALYZE')

    const plan = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<Record<string, string>[]>(`
        EXPLAIN SELECT id FROM (
          SELECT t.id FROM "LocalReleaseArtist" lra JOIN "LocalReleaseTrack" t ON t."localReleaseId" = lra."localReleaseId" WHERE lra."artistId" = '${artist.id}'
          UNION
          SELECT tra."trackId" AS id FROM "TrackRelatedArtist" tra WHERE tra."artistId" = '${artist.id}'
        ) u LIMIT 10000`)
      return rows.map(r => r['QUERY PLAN']).join('\n')
    })

    expect(plan).not.toMatch(/Seq Scan on "LocalReleaseTrack"/)
    expect(await listArtistTrackIds(artist.id)).toHaveLength(50)
  })
})
