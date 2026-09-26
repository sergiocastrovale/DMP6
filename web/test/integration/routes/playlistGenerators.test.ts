import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeUser } from '../../../test/factories'

// Exercises the FK/cascade behaviour the migration.sql relies on. The test DB is built by replaying the
// migrations (test/setup/db.ts); resetDb() truncates the seed rows they insert, so each test starts empty.
const prisma = getTestPrisma()

describe('PlaylistGenerator (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('deleting a generator cascades to its generated playlist (and its tracks)', async () => {
    const generator = await prisma.playlistGenerator.create({
      data: { type: 'GENRE', name: 'Rock', slug: 'rock', terms: ['rock', '-indie rock'] },
    })
    const playlist = await prisma.playlist.create({
      data: { type: 'GENRE', name: 'Rock', slug: 'genre-rock', generatorId: generator.id },
    })

    await prisma.playlistGenerator.delete({ where: { id: generator.id } })

    expect(await prisma.playlist.findUnique({ where: { id: playlist.id } })).toBeNull()
  })

  it('deleting a MANUAL playlist does not touch any generator', async () => {
    const generator = await prisma.playlistGenerator.create({
      data: { type: 'REGION', name: 'Japan', slug: 'japan', terms: ['JP'] },
    })
    const owner = await makeUser(prisma)
    const manual = await prisma.playlist.create({
      data: { type: 'MANUAL', name: 'My Mix', slug: 'my-mix', userId: owner.id },
    })

    await prisma.playlist.delete({ where: { id: manual.id } })

    expect(await prisma.playlistGenerator.findUnique({ where: { id: generator.id } })).not.toBeNull()
  })

  it('rejects a second generator with the same slug', async () => {
    await prisma.playlistGenerator.create({
      data: { type: 'GENRE', name: 'Rock', slug: 'rock', terms: ['rock'] },
    })

    await expect(
      prisma.playlistGenerator.create({
        data: { type: 'GENRE', name: 'Rock (dup)', slug: 'rock', terms: ['rock'] },
      }),
    ).rejects.toThrow()
  })

  it('a generator can only back one playlist (generatorId is unique)', async () => {
    const generator = await prisma.playlistGenerator.create({
      data: { type: 'GENRE', name: 'Rock', slug: 'rock', terms: ['rock'] },
    })
    await prisma.playlist.create({
      data: { type: 'GENRE', name: 'Rock', slug: 'genre-rock', generatorId: generator.id },
    })

    await expect(
      prisma.playlist.create({
        data: { type: 'GENRE', name: 'Rock 2', slug: 'genre-rock-2', generatorId: generator.id },
      }),
    ).rejects.toThrow()
  })
})
