import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { H3Event } from 'h3'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeUser, makeLocalRelease, makeLocalTrack } from '../../../test/factories'
import { star, unstar, scrobble } from '../../../server/utils/subsonic/endpoints/annotation'
import { makeParams } from '../../../server/utils/subsonic/params'
import type { HandlerContext } from '../../../server/utils/subsonic/types'
import type { SessionUser } from '../../../types/auth'

const prisma = getTestPrisma()

// star/unstar/scrobble never touch the H3Event they're handed - only ctx.user/ctx.params.
const NO_EVENT = {} as H3Event

const ctxFor = (user: SessionUser, raw: Record<string, unknown>): HandlerContext => ({
  user,
  params: makeParams(raw),
  format: 'json',
})

const asUser = (u: { id: number, username: string, email: string, role: 'VIEWER' | 'MANAGER' | 'ADMIN', mustChangePassword: boolean }): SessionUser => u

describe('Subsonic star/unstar/scrobble (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('star with id favorites a track', async () => {
    const alice = await makeUser(prisma)
    const track = await makeLocalTrack(prisma)

    await star(NO_EVENT, ctxFor(asUser(alice), { id: track.id }))

    const fav = await prisma.favoriteTrack.findUnique({ where: { userId_trackId: { userId: alice.id, trackId: track.id } } })
    expect(fav).not.toBeNull()
  })

  it('star with albumId favorites a release', async () => {
    const alice = await makeUser(prisma)
    const release = await makeLocalRelease(prisma)

    await star(NO_EVENT, ctxFor(asUser(alice), { albumId: release.id }))

    const fav = await prisma.favoriteRelease.findUnique({ where: { userId_releaseId: { userId: alice.id, releaseId: release.id } } })
    expect(fav).not.toBeNull()
  })

  it('star is idempotent (upsert, not a unique-constraint error)', async () => {
    const alice = await makeUser(prisma)
    const track = await makeLocalTrack(prisma)
    await star(NO_EVENT, ctxFor(asUser(alice), { id: track.id }))
    await expect(star(NO_EVENT, ctxFor(asUser(alice), { id: track.id }))).resolves.toEqual({})
  })

  it('star with an unknown id 404s', async () => {
    const alice = await makeUser(prisma)
    await expect(star(NO_EVENT, ctxFor(asUser(alice), { id: 'nonexistent' }))).rejects.toMatchObject({ statusCode: 404 })
  })

  it('unstar removes a favorite', async () => {
    const alice = await makeUser(prisma)
    const track = await makeLocalTrack(prisma)
    await star(NO_EVENT, ctxFor(asUser(alice), { id: track.id }))

    await unstar(NO_EVENT, ctxFor(asUser(alice), { id: track.id }))

    const fav = await prisma.favoriteTrack.findUnique({ where: { userId_trackId: { userId: alice.id, trackId: track.id } } })
    expect(fav).toBeNull()
  })

  it('unstar on a never-starred id is a silent no-op', async () => {
    const alice = await makeUser(prisma)
    const track = await makeLocalTrack(prisma)
    await expect(unstar(NO_EVENT, ctxFor(asUser(alice), { id: track.id }))).resolves.toEqual({})
  })

  it('scrobble with submission=true creates a counted PlayEvent and increments the play counter', async () => {
    const alice = await makeUser(prisma)
    const track = await makeLocalTrack(prisma, { duration: 200 })

    await scrobble(NO_EVENT, ctxFor(asUser(alice), { id: track.id, submission: 'true' }))

    const events = await prisma.playEvent.findMany({ where: { userId: alice.id, trackId: track.id } })
    expect(events).toHaveLength(1)
    expect(events[0]!.counted).toBe(true)
    expect(events[0]!.source).toBe('SUBSONIC')

    const play = await prisma.localReleaseTrackPlay.findUnique({ where: { userId_trackId: { userId: alice.id, trackId: track.id } } })
    expect(play?.playCount).toBe(1)
  })

  it('scrobble with submission=false (now-playing) does not create a PlayEvent', async () => {
    const alice = await makeUser(prisma)
    const track = await makeLocalTrack(prisma)

    await scrobble(NO_EVENT, ctxFor(asUser(alice), { id: track.id, submission: 'false' }))

    expect(await prisma.playEvent.count({ where: { userId: alice.id, trackId: track.id } })).toBe(0)
  })

  it('scrobble with a missing id param throws (code carried via SubsonicApiError)', async () => {
    const alice = await makeUser(prisma)
    await expect(scrobble(NO_EVENT, ctxFor(asUser(alice), {}))).rejects.toThrow()
  })

  it('scrobble for an unknown track 404s', async () => {
    const alice = await makeUser(prisma)
    await expect(scrobble(NO_EVENT, ctxFor(asUser(alice), { id: 'nonexistent' }))).rejects.toMatchObject({ statusCode: 404 })
  })
})
