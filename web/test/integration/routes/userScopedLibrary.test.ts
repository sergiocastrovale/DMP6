import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeUser, makeLocalRelease, makeLocalTrack, makeMbRelease, makePlaylist } from '../../../test/factories'
import { visiblePlaylistsWhere } from '../../../server/utils/libraryOwnership'
import { favoriteReleaseCard, favoriteReleaseSelect } from '../../../server/utils/favorites'

// Favorites and MANUAL playlists are per-user and private (CLAUDE.md Data Model). Exercised against
// real Postgres because the FK/cascade and composite-unique behaviour the routes rely on is DB-level,
// not something a mocked-prisma unit test can fake. The raw-SQL CHECKs and partial unique index that also
// guard this (prisma/migrations/20260914000000_...) exist here because the test DB is built by replaying
// the migrations (test/setup/db.ts); test/integration/constraints.test.ts asserts them directly.
// verifyImage needs Nuxt's runtime config + settings cache; this suite is about rows, not image files.
vi.mock('../../../server/utils/images', () => ({
  verifyImage: (image: string | null, imageUrl: string | null) => ({ image, imageUrl }),
}))

const prisma = getTestPrisma()

describe('user-scoped favorites and playlists (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('two users can each favorite the same release without colliding', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    const release = await makeLocalRelease(prisma)

    await prisma.favoriteRelease.create({ data: { userId: alice.id, releaseId: release.id } })
    await prisma.favoriteRelease.create({ data: { userId: bob.id, releaseId: release.id } })

    expect(await prisma.favoriteRelease.count({ where: { releaseId: release.id } })).toBe(2)
    expect(await prisma.favoriteRelease.findUnique({
      where: { userId_releaseId: { userId: alice.id, releaseId: release.id } },
    })).not.toBeNull()
  })

  it('a second favorite by the same user on the same release is rejected (composite unique)', async () => {
    const alice = await makeUser(prisma)
    const release = await makeLocalRelease(prisma)
    await prisma.favoriteRelease.create({ data: { userId: alice.id, releaseId: release.id } })

    await expect(
      prisma.favoriteRelease.create({ data: { userId: alice.id, releaseId: release.id } }),
    ).rejects.toThrow()
  })

  // A dissolved box has no LocalRelease of its own, so it is favorited via its MusicBrainzRelease
  // (FavoriteRelease.boxReleaseId) - one row for the box, never one per disc. The either/or CHECK is raw
  // migration SQL (asserted in constraints.test.ts); this covers the schema-level behaviour.
  describe('box favorites', () => {
    const makeBox = async () => {
      const box = await makeMbRelease(prisma, { title: 'Deliverance & Damnation', mediumCount: 2 })
      const disc1 = await makeLocalRelease(prisma, { title: 'Deliverance', boxReleaseId: box.id, boxMediumPosition: 1, image: 'disc1.jpg' })
      const disc2 = await makeLocalRelease(prisma, { title: 'Damnation', boxReleaseId: box.id, boxMediumPosition: 2 })
      return { box, disc1, disc2 }
    }

    it('one favorite per user per box, independent of the per-release favorites', async () => {
      const alice = await makeUser(prisma)
      const { box, disc1 } = await makeBox()
      await prisma.favoriteRelease.create({ data: { userId: alice.id, boxReleaseId: box.id } })
      await prisma.favoriteRelease.create({ data: { userId: alice.id, releaseId: disc1.id } })

      await expect(
        prisma.favoriteRelease.create({ data: { userId: alice.id, boxReleaseId: box.id } }),
      ).rejects.toThrow()
      expect(await prisma.favoriteRelease.count({ where: { userId: alice.id } })).toBe(2)
    })

    it('deleting the box release cascades its favorites away', async () => {
      const alice = await makeUser(prisma)
      const { box } = await makeBox()
      await prisma.favoriteRelease.create({ data: { userId: alice.id, boxReleaseId: box.id } })

      await prisma.localRelease.deleteMany({ where: { boxReleaseId: box.id } })
      await prisma.musicBrainzRelease.delete({ where: { id: box.id } })

      expect(await prisma.favoriteRelease.count({ where: { userId: alice.id } })).toBe(0)
    })

    it('lists a box favorite as a card addressed by the box id, with the first disc\'s cover', async () => {
      const alice = await makeUser(prisma)
      const artist = await prisma.artist.create({ data: { name: 'Opeth', slug: 'opeth' } })
      const { box, disc1 } = await makeBox()
      await prisma.localReleaseArtist.create({ data: { localReleaseId: disc1.id, artistId: artist.id } })
      await prisma.favoriteRelease.create({ data: { userId: alice.id, boxReleaseId: box.id } })

      const rows = await prisma.favoriteRelease.findMany({ where: { userId: alice.id }, select: favoriteReleaseSelect })
      expect(rows.map(favoriteReleaseCard)).toEqual([
        expect.objectContaining({ id: box.id, title: 'Deliverance & Damnation', image: 'disc1.jpg', artist: expect.objectContaining({ slug: 'opeth' }) }),
      ])
    })
  })

  it('two users can each favorite the same track without colliding', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    const track = await makeLocalTrack(prisma)

    await prisma.favoriteTrack.create({ data: { userId: alice.id, trackId: track.id } })
    await prisma.favoriteTrack.create({ data: { userId: bob.id, trackId: track.id } })

    expect(await prisma.favoriteTrack.count({ where: { trackId: track.id } })).toBe(2)
  })

  it('deleting a user cascades their favorites but leaves the release/track and other users\' favorites', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    const release = await makeLocalRelease(prisma)
    const track = await makeLocalTrack(prisma)
    await prisma.favoriteRelease.create({ data: { userId: alice.id, releaseId: release.id } })
    await prisma.favoriteRelease.create({ data: { userId: bob.id, releaseId: release.id } })
    await prisma.favoriteTrack.create({ data: { userId: alice.id, trackId: track.id } })

    await prisma.user.delete({ where: { id: alice.id } })

    expect(await prisma.favoriteRelease.count({ where: { userId: alice.id } })).toBe(0)
    expect(await prisma.favoriteRelease.count({ where: { userId: bob.id } })).toBe(1)
    expect(await prisma.favoriteTrack.count({ where: { userId: alice.id } })).toBe(0)
    expect(await prisma.localRelease.findUnique({ where: { id: release.id } })).not.toBeNull()
    expect(await prisma.localReleaseTrack.findUnique({ where: { id: track.id } })).not.toBeNull()
  })

  it('two users can each name a MANUAL playlist the same slug', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)

    await makePlaylist(prisma, { userId: alice.id, slug: 'road-trip' })
    await makePlaylist(prisma, { userId: bob.id, slug: 'road-trip' })

    expect(await prisma.playlist.count({ where: { slug: 'road-trip' } })).toBe(2)
  })

  it('the same user cannot reuse a slug for a second MANUAL playlist', async () => {
    const alice = await makeUser(prisma)
    await makePlaylist(prisma, { userId: alice.id, slug: 'road-trip' })

    await expect(
      makePlaylist(prisma, { userId: alice.id, slug: 'road-trip' }),
    ).rejects.toThrow()
  })

  it('visiblePlaylistsWhere returns a user\'s own playlists and generated ones, never another user\'s', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    const ownPlaylist = await makePlaylist(prisma, { userId: alice.id, slug: 'alice-mix' })
    const bobsPlaylist = await makePlaylist(prisma, { userId: bob.id, slug: 'bob-mix' })
    const generated = await makePlaylist(prisma, { userId: null, type: 'GENRE', slug: 'genre-rock' })

    const visible = await prisma.playlist.findMany({ where: visiblePlaylistsWhere(alice.id) })
    const ids = visible.map(p => p.id).sort()

    expect(ids).toEqual([ownPlaylist.id, generated.id].sort())
    expect(ids).not.toContain(bobsPlaylist.id)
  })

  it('deleting a user cascades their MANUAL playlists (and tracks) but leaves generated playlists', async () => {
    const alice = await makeUser(prisma)
    const playlist = await makePlaylist(prisma, { userId: alice.id, slug: 'alice-mix' })
    const track = await makeLocalTrack(prisma)
    await prisma.playlistTrack.create({ data: { playlistId: playlist.id, trackId: track.id, position: 0 } })
    const generated = await makePlaylist(prisma, { userId: null, type: 'GENRE', slug: 'genre-rock' })

    await prisma.user.delete({ where: { id: alice.id } })

    expect(await prisma.playlist.findUnique({ where: { id: playlist.id } })).toBeNull()
    expect(await prisma.playlistTrack.count({ where: { playlistId: playlist.id } })).toBe(0)
    expect(await prisma.playlist.findUnique({ where: { id: generated.id } })).not.toBeNull()
  })
})
