import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../setup/db'
import { makeLocalRelease, makeMbRelease, makeUser } from '../factories'

// The test database is built by replaying prisma/migrations, so the raw-SQL constraints Prisma can't
// declare in schema.prisma are present here. These tests pin that: if the test DB ever goes back to
// `db push`, they fail.
const prisma = getTestPrisma()

describe('raw-SQL constraints from migrations', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('Playlist: a MANUAL playlist must have an owner', async () => {
    await expect(
      prisma.playlist.create({ data: { name: 'Orphan', slug: 'orphan', type: 'MANUAL', userId: null } }),
    ).rejects.toThrow()
  })

  it('Playlist: a generated (GENRE) playlist must not have an owner', async () => {
    const user = await makeUser(prisma)
    await expect(
      prisma.playlist.create({ data: { name: 'Owned genre', slug: 'owned-genre', type: 'GENRE', userId: user.id } }),
    ).rejects.toThrow()
  })

  it('Playlist: generated slugs are unique across generated playlists', async () => {
    await prisma.playlist.create({ data: { name: 'Rock', slug: 'rock', type: 'GENRE' } })
    await expect(
      prisma.playlist.create({ data: { name: 'Rock 2', slug: 'rock', type: 'GENRE' } }),
    ).rejects.toThrow()
  })

  it('FavoriteRelease: exactly one of releaseId / boxReleaseId', async () => {
    const user = await makeUser(prisma)
    const release = await makeLocalRelease(prisma)
    const box = await makeMbRelease(prisma, { title: 'A Box', mediumCount: 2 })

    await expect(
      prisma.favoriteRelease.create({ data: { userId: user.id } }),
    ).rejects.toThrow()
    await expect(
      prisma.favoriteRelease.create({ data: { userId: user.id, releaseId: release.id, boxReleaseId: box.id } }),
    ).rejects.toThrow()
    await expect(
      prisma.favoriteRelease.create({ data: { userId: user.id, releaseId: release.id } }),
    ).resolves.toBeTruthy()
  })
})
