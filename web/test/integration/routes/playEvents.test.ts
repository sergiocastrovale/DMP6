import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeUser, makeLocalTrack } from '../../../test/factories'
import { applyPlayEventPatch, recordExternalPlay } from '../../../server/utils/playEvents'

const scrobble = vi.hoisted(() => ({ scrobbleInBackground: vi.fn() }))
vi.mock('../../../server/utils/scrobble', () => scrobble)

// The counted false->true transition is guarded (server/utils/playEvents.ts) so it only ever runs
// recordPlay once per event, even racing - exercised against real Postgres because that guarantee is
// a DB-level `updateMany` guard, not something a mocked-prisma unit test can prove.
const prisma = getTestPrisma()

describe('play events (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
    scrobble.scrobbleInBackground.mockClear()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('the counted transition increments LocalReleaseTrackPlay exactly once under two concurrent patches', async () => {
    const alice = await makeUser(prisma)
    const track = await makeLocalTrack(prisma)
    const event = await prisma.playEvent.create({
      data: { userId: alice.id, trackId: track.id, source: 'QUEUE' },
    })

    await Promise.all([
      applyPlayEventPatch(alice.id, event.id, { listenedSeconds: 120, counted: true }),
      applyPlayEventPatch(alice.id, event.id, { listenedSeconds: 121, counted: true }),
    ])

    const play = await prisma.localReleaseTrackPlay.findUnique({
      where: { userId_trackId: { userId: alice.id, trackId: track.id } },
    })
    expect(play?.playCount).toBe(1)

    const updated = await prisma.playEvent.findUniqueOrThrow({ where: { id: event.id } })
    expect(updated.counted).toBe(true)
    expect(updated.listenedSeconds).toBe(121)
  })

  it('listenedSeconds never shrinks and the counter increments once, however concurrent patches interleave', async () => {
    const alice = await makeUser(prisma)
    for (let round = 0; round < 8; round++) {
      const track = await makeLocalTrack(prisma)
      const event = await prisma.playEvent.create({
        data: { userId: alice.id, trackId: track.id, source: 'QUEUE' },
      })

      // Smaller values arrive after larger ones in some orders - the row lock makes each see the last commit.
      await Promise.all([30, 120, 60, 121].map(seconds =>
        applyPlayEventPatch(alice.id, event.id, { listenedSeconds: seconds, counted: seconds >= 60 }),
      ))

      const updated = await prisma.playEvent.findUniqueOrThrow({ where: { id: event.id } })
      expect(updated.listenedSeconds).toBe(121)
      expect(updated.counted).toBe(true)
      const play = await prisma.localReleaseTrackPlay.findUniqueOrThrow({
        where: { userId_trackId: { userId: alice.id, trackId: track.id } },
      })
      expect(play.playCount).toBe(1)
    }
  })

  it('404s (and writes nothing) for an unknown event or another user\'s event', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    const track = await makeLocalTrack(prisma)
    const event = await prisma.playEvent.create({ data: { userId: alice.id, trackId: track.id, source: 'QUEUE' } })

    await expect(applyPlayEventPatch(bob.id, event.id, { counted: true })).rejects.toMatchObject({ statusCode: 404 })
    await expect(applyPlayEventPatch(alice.id, 'nope', { counted: true })).rejects.toMatchObject({ statusCode: 404 })

    expect((await prisma.playEvent.findUniqueOrThrow({ where: { id: event.id } })).counted).toBe(false)
    expect(await prisma.localReleaseTrackPlay.count()).toBe(0)
  })

  it('a second counted patch after the first is a no-op - no double increment', async () => {
    const alice = await makeUser(prisma)
    const track = await makeLocalTrack(prisma)
    const event = await prisma.playEvent.create({
      data: { userId: alice.id, trackId: track.id, source: 'QUEUE' },
    })

    await applyPlayEventPatch(alice.id, event.id, { counted: true })
    await applyPlayEventPatch(alice.id, event.id, { counted: true })

    const play = await prisma.localReleaseTrackPlay.findUnique({
      where: { userId_trackId: { userId: alice.id, trackId: track.id } },
    })
    expect(play?.playCount).toBe(1)
  })

  it('another user\'s event id 404s rather than leaking whose id exists', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    const track = await makeLocalTrack(prisma)
    const event = await prisma.playEvent.create({
      data: { userId: alice.id, trackId: track.id, source: 'QUEUE' },
    })

    await expect(applyPlayEventPatch(bob.id, event.id, { counted: true })).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('an unknown event id 404s', async () => {
    const alice = await makeUser(prisma)
    await expect(applyPlayEventPatch(alice.id, 'nonexistent', { counted: true })).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('deleting the track cascades its PlayEvent and LocalReleaseTrackPlay rows', async () => {
    const alice = await makeUser(prisma)
    const track = await makeLocalTrack(prisma)
    const event = await prisma.playEvent.create({
      data: { userId: alice.id, trackId: track.id, source: 'QUEUE' },
    })
    await applyPlayEventPatch(alice.id, event.id, { counted: true })

    await prisma.localReleaseTrack.delete({ where: { id: track.id } })

    expect(await prisma.playEvent.count({ where: { id: event.id } })).toBe(0)
    expect(await prisma.localReleaseTrackPlay.count({ where: { userId: alice.id } })).toBe(0)
  })

  it('scrobbles to Last.fm exactly once per counted listen, with the listen\'s own start time', async () => {
    const alice = await makeUser(prisma)
    const track = await makeLocalTrack(prisma)
    const startedAt = new Date('2026-09-26T10:00:00Z')
    const event = await prisma.playEvent.create({ data: { userId: alice.id, trackId: track.id, source: 'QUEUE', startedAt } })

    await applyPlayEventPatch(alice.id, event.id, { listenedSeconds: 10 })
    expect(scrobble.scrobbleInBackground).not.toHaveBeenCalled()

    await applyPlayEventPatch(alice.id, event.id, { listenedSeconds: 120, counted: true })
    await applyPlayEventPatch(alice.id, event.id, { listenedSeconds: 130, counted: true })
    await applyPlayEventPatch(alice.id, event.id, { listenedSeconds: 140, ended: true })

    expect(scrobble.scrobbleInBackground).toHaveBeenCalledTimes(1)
    expect(scrobble.scrobbleInBackground).toHaveBeenCalledWith(track.id, startedAt.getTime())
  })

  it('two concurrent counted patches still scrobble once', async () => {
    const alice = await makeUser(prisma)
    const track = await makeLocalTrack(prisma)
    const event = await prisma.playEvent.create({ data: { userId: alice.id, trackId: track.id, source: 'QUEUE' } })

    await Promise.all([
      applyPlayEventPatch(alice.id, event.id, { listenedSeconds: 120, counted: true }),
      applyPlayEventPatch(alice.id, event.id, { listenedSeconds: 121, counted: true }),
    ])

    expect(scrobble.scrobbleInBackground).toHaveBeenCalledTimes(1)
  })

  it('a listen a Subsonic client reports is scrobbled too', async () => {
    const alice = await makeUser(prisma)
    const track = await makeLocalTrack(prisma, { duration: 200 })

    await recordExternalPlay(alice.id, track.id)

    expect(scrobble.scrobbleInBackground).toHaveBeenCalledTimes(1)
    expect(scrobble.scrobbleInBackground).toHaveBeenCalledWith(track.id, expect.any(Number))
  })
})
