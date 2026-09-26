import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeUser, makeLocalRelease, makeLocalTrack, makePlaylist } from '../../../test/factories'
import { appendPlaylistTrack, createManualPlaylist } from '../../../server/utils/playlistWrites'

const prisma = getTestPrisma()

describe('playlist writes (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('10 concurrent appends get 10 distinct, gap-free positions', async () => {
    const user = await makeUser(prisma)
    const release = await makeLocalRelease(prisma)
    const playlist = await makePlaylist(prisma, { userId: user.id })
    const tracks = await Promise.all(Array.from({ length: 10 }, () => makeLocalTrack(prisma, { localReleaseId: release.id })))

    await Promise.all(tracks.map(t => appendPlaylistTrack(playlist.id, t.id)))

    const positions = (await prisma.playlistTrack.findMany({ where: { playlistId: playlist.id }, select: { position: true } }))
      .map(r => r.position).sort((a, b) => a - b)
    expect(positions).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('appending the same track twice is a unique-constraint error, not a duplicate row', async () => {
    const user = await makeUser(prisma)
    const release = await makeLocalRelease(prisma)
    const playlist = await makePlaylist(prisma, { userId: user.id })
    const track = await makeLocalTrack(prisma, { localReleaseId: release.id })

    await appendPlaylistTrack(playlist.id, track.id)
    await expect(appendPlaylistTrack(playlist.id, track.id)).rejects.toMatchObject({ code: 'P2002' })
    expect(await prisma.playlistTrack.count({ where: { playlistId: playlist.id } })).toBe(1)
  })

  it('two concurrent creates of the same name: one wins, the other is a 409 (never a 500)', async () => {
    const user = await makeUser(prisma)

    const results = await Promise.allSettled([
      createManualPlaylist(user.id, { name: 'Road Trip', slug: 'road-trip' }),
      createManualPlaylist(user.id, { name: 'Road Trip', slug: 'road-trip' }),
    ])

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult
    expect(rejected.reason).toMatchObject({ statusCode: 409 })
    expect(await prisma.playlist.count({ where: { userId: user.id } })).toBe(1)
  })

  it('a slug taken by a shared generated playlist is a 409 for every user', async () => {
    const user = await makeUser(prisma)
    await makePlaylist(prisma, { type: 'GENRE', userId: null, slug: 'rock', name: 'Rock' })

    await expect(createManualPlaylist(user.id, { name: 'Rock', slug: 'rock' })).rejects.toMatchObject({ statusCode: 409 })
  })

  it('two users can each own a playlist with the same slug', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)

    await createManualPlaylist(alice.id, { name: 'Mix', slug: 'mix' })
    await expect(createManualPlaylist(bob.id, { name: 'Mix', slug: 'mix' })).resolves.toMatchObject({ slug: 'mix' })
  })
})
