import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTestPrisma, resetDb } from '../../setup/db'
import { makeLocalRelease, makeLocalTrack, makeMbRelease, makeUser } from '../../factories'
import { attachTrackFavorites, favoriteReleaseTargetIds } from '../../../server/utils/favorites'

vi.mock('../../../server/utils/images', () => ({
  verifyImage: (image: string | null, imageUrl: string | null) => ({ image, imageUrl }),
}))

const prisma = getTestPrisma()

describe('favorite state in payloads (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('attachTrackFavorites flags exactly this user\'s favorites - even when they have more than 50', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    // 120 tracks; alice favorited the OLDEST 60 - the ones a "first page of newest favorites" fetch would miss.
    const tracks = []
    for (let i = 0; i < 120; i++) {
      tracks.push(await makeLocalTrack(prisma, { title: `T${i}` }))
    }
    await prisma.favoriteTrack.createMany({
      data: tracks.slice(0, 60).map((t, i) => ({ userId: alice.id, trackId: t.id, createdAt: new Date(2020, 0, 1, 0, 0, i) })),
    })
    await prisma.favoriteTrack.create({ data: { userId: bob.id, trackId: tracks[100]!.id } })

    const withFlags = await attachTrackFavorites(alice.id, tracks.map(t => ({ id: t.id })))

    expect(withFlags.filter(t => t.isFavorite).map(t => t.id).sort()).toEqual(tracks.slice(0, 60).map(t => t.id).sort())
  })

  it('never flags missing (MusicBrainz-only) tracks and skips the query when there is nothing to check', async () => {
    const alice = await makeUser(prisma)
    const result = await attachTrackFavorites(alice.id, [{ id: 'mb-only', missing: true }])
    expect(result).toEqual([{ id: 'mb-only', missing: true, isFavorite: false }])
    expect(await attachTrackFavorites(alice.id, [])).toEqual([])
  })

  it('favoriteReleaseTargetIds returns local release ids and dissolved-box ids, per user', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    const release = await makeLocalRelease(prisma)
    const other = await makeLocalRelease(prisma)
    const box = await makeMbRelease(prisma, { title: 'Box', mediumCount: 2 })
    await prisma.favoriteRelease.create({ data: { userId: alice.id, releaseId: release.id } })
    await prisma.favoriteRelease.create({ data: { userId: alice.id, boxReleaseId: box.id } })
    await prisma.favoriteRelease.create({ data: { userId: bob.id, releaseId: other.id } })

    expect([...await favoriteReleaseTargetIds(alice.id)].sort()).toEqual([release.id, box.id].sort())
    expect([...await favoriteReleaseTargetIds(bob.id)]).toEqual([other.id])
  })
})
