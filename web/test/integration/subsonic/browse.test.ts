import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { H3Event } from 'h3'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeUser, makeArtist, makeLocalRelease, makeLocalTrack } from '../../../test/factories'
import { getArtists, getArtist, getAlbum, getSong } from '../../../server/utils/subsonic/endpoints/browse'
import { makeParams } from '../../../server/utils/subsonic/params'
import { SubsonicErrorCode } from '../../../server/utils/subsonic/errors'
import type { HandlerContext } from '../../../server/utils/subsonic/types'
import type { SessionUser } from '../../../types/auth'

const prisma = getTestPrisma()
const NO_EVENT = {} as H3Event

const ctxFor = (user: SessionUser, raw: Record<string, unknown> = {}): HandlerContext => ({
  user,
  params: makeParams(raw),
  format: 'json',
})

// A release with at least one track, owned by `artistId` - the shape both getArtists' ownership
// filter and getAlbum's "must have a track to stream" filter require (subsonicArtistWhere/
// subsonicAlbumWhere).
const makeOwnedAlbum = async (artistId: string, overrides: Parameters<typeof makeLocalRelease>[1] = {}) => {
  const release = await makeLocalRelease(prisma, overrides)
  await prisma.localReleaseArtist.create({ data: { localReleaseId: release.id, artistId } })
  await makeLocalTrack(prisma, { localReleaseId: release.id, trackNumber: 1 })
  return release
}

describe('Subsonic browse endpoints (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('getArtists only lists artists that own a release with a track', async () => {
    const alice = await makeUser(prisma)
    const owner = await makeArtist(prisma, { name: 'Air' })
    await makeOwnedAlbum(owner.id)
    // A credit-only artist (appears-on, no owned release) must not appear in Subsonic browsing,
    // same rule as /browse (server/api/artists/index.get.ts).
    await makeArtist(prisma, { name: 'Ghost Feature' })

    const result = await getArtists(NO_EVENT, ctxFor(alice))
    const artists = result.artists as any
    const names = artists.index.flatMap((i: any) => i.artist.map((a: any) => a.name))
    expect(names).toContain('Air')
    expect(names).not.toContain('Ghost Feature')
  })

  it('getArtists excludes a connected duplicate (primaryArtistId set)', async () => {
    const alice = await makeUser(prisma)
    const canonical = await makeArtist(prisma, { name: 'Canonical' })
    const dup = await makeArtist(prisma, { name: 'Duplicate', primaryArtistId: canonical.id })
    await makeOwnedAlbum(dup.id)

    const result = await getArtists(NO_EVENT, ctxFor(alice))
    const artists = result.artists as any
    const names = artists.index.flatMap((i: any) => i.artist.map((a: any) => a.name))
    expect(names).not.toContain('Duplicate')
  })

  it('getArtist returns the artist plus its albums', async () => {
    const alice = await makeUser(prisma)
    const artist = await makeArtist(prisma, { name: 'Air' })
    const album = await makeOwnedAlbum(artist.id, { title: 'Moon Safari' })

    const result = await getArtist(NO_EVENT, ctxFor(alice, { id: artist.id }))
    const out = result.artist as any
    expect(out.name).toBe('Air')
    expect(out.album).toHaveLength(1)
    expect(out.album[0].id).toBe(album.id)
  })

  it('getArtist 404s for an unknown or unowning artist id', async () => {
    const alice = await makeUser(prisma)
    await expect(getArtist(NO_EVENT, ctxFor(alice, { id: 'nonexistent' }))).rejects.toMatchObject({ code: SubsonicErrorCode.NOT_FOUND })
  })

  it('getAlbum returns its songs in track order', async () => {
    const alice = await makeUser(prisma)
    const artist = await makeArtist(prisma)
    const release = await makeLocalRelease(prisma, { title: 'Moon Safari' })
    await prisma.localReleaseArtist.create({ data: { localReleaseId: release.id, artistId: artist.id } })
    const t2 = await makeLocalTrack(prisma, { localReleaseId: release.id, trackNumber: 2, title: 'Sexy Boy' })
    const t1 = await makeLocalTrack(prisma, { localReleaseId: release.id, trackNumber: 1, title: 'La Femme d\'Argent' })

    const result = await getAlbum(NO_EVENT, ctxFor(alice, { id: release.id }))
    const out = result.album as any
    expect(out.songCount).toBe(2)
    expect(out.song.map((s: any) => s.id)).toEqual([t1.id, t2.id])
  })

  it('getAlbum 404s for a MISSING placeholder release with no local track', async () => {
    const alice = await makeUser(prisma)
    const release = await makeLocalRelease(prisma, { matchStatus: 'MISSING' })
    await expect(getAlbum(NO_EVENT, ctxFor(alice, { id: release.id }))).rejects.toThrow()
  })

  it('getSong reports the caller\'s own play count, not a global one', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    const track = await makeLocalTrack(prisma)
    await prisma.localReleaseTrackPlay.create({ data: { userId: bob.id, trackId: track.id, playCount: 9, lastPlayedAt: new Date() } })

    const result = await getSong(NO_EVENT, ctxFor(alice, { id: track.id }))
    expect((result.song as any).playCount).toBeUndefined()
  })
})
