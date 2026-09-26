import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { H3Event } from 'h3'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeUser, makeLocalTrack, makePlaylist } from '../../../test/factories'
import { getPlaylists, getPlaylist, createPlaylist, deletePlaylist } from '../../../server/utils/subsonic/endpoints/playlists'
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

describe('Subsonic playlist endpoints (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('createPlaylist makes a private MANUAL playlist owned by the caller, with its songs', async () => {
    const alice = await makeUser(prisma)
    const t1 = await makeLocalTrack(prisma)
    const t2 = await makeLocalTrack(prisma)

    const result = await createPlaylist(NO_EVENT, ctxFor(alice, { name: 'Road Trip', songId: [t1.id, t2.id] }))
    const out = result.playlist as any
    expect(out.name).toBe('Road Trip')
    expect(out.songCount).toBe(2)
    expect(out.entry.map((s: any) => s.id)).toEqual([t1.id, t2.id])

    const row = await prisma.playlist.findUniqueOrThrow({ where: { id: out.id } })
    expect(row.userId).toBe(alice.id)
    expect(row.type).toBe('MANUAL')
  })

  it('createPlaylist 409s on a name colliding with the caller\'s own slug', async () => {
    const alice = await makeUser(prisma)
    await createPlaylist(NO_EVENT, ctxFor(alice, { name: 'Road Trip' }))
    await expect(createPlaylist(NO_EVENT, ctxFor(alice, { name: 'Road Trip' }))).rejects.toMatchObject({ statusCode: 409 })
  })

  it('getPlaylists includes the caller\'s own playlists and shared generated ones, not another user\'s', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    const mine = await makePlaylist(prisma, { userId: alice.id, name: 'Mine' })
    await makePlaylist(prisma, { userId: bob.id, name: 'Bobs' })
    const shared = await makePlaylist(prisma, { userId: null, type: 'GENRE', name: 'Shared' })

    const result = await getPlaylists(NO_EVENT, ctxFor(alice))
    const names = (result.playlists as any).playlist.map((p: any) => p.name)
    expect(names).toContain(mine.name)
    expect(names).toContain(shared.name)
    expect(names).not.toContain('Bobs')
  })

  it('advertises cover art for a playlist that has tracks, and none for an empty one', async () => {
    const alice = await makeUser(prisma)
    const track = await makeLocalTrack(prisma)
    const full = await createPlaylist(NO_EVENT, ctxFor(alice, { name: 'Full', songId: [track.id] }))
    const empty = await createPlaylist(NO_EVENT, ctxFor(alice, { name: 'Empty' }))

    expect((full.playlist as any).coverArt).toBe(`pl-${(full.playlist as any).id}`)
    expect((empty.playlist as any).coverArt).toBeUndefined()

    const listed = (await getPlaylists(NO_EVENT, ctxFor(alice)).then(r => (r.playlists as any).playlist)) as any[]
    expect(listed.find(p => p.name === 'Full').coverArt).toBe(`pl-${(full.playlist as any).id}`)
    expect(listed.find(p => p.name === 'Empty').coverArt).toBeUndefined()
  })

  it('getPlaylist 404s for another user\'s private playlist', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    const bobsPlaylist = await makePlaylist(prisma, { userId: bob.id })

    await expect(getPlaylist(NO_EVENT, ctxFor(alice, { id: bobsPlaylist.id }))).rejects.toMatchObject({ code: SubsonicErrorCode.NOT_FOUND })
  })

  it('deletePlaylist removes the caller\'s own playlist', async () => {
    const alice = await makeUser(prisma)
    const playlist = await makePlaylist(prisma, { userId: alice.id })

    await deletePlaylist(NO_EVENT, ctxFor(alice, { id: playlist.id }))

    expect(await prisma.playlist.count({ where: { id: playlist.id } })).toBe(0)
  })

  it('deletePlaylist 404s on a shared generated playlist rather than deleting it', async () => {
    const alice = await makeUser(prisma)
    const shared = await makePlaylist(prisma, { userId: null, type: 'REGION' })

    await expect(deletePlaylist(NO_EVENT, ctxFor(alice, { id: shared.id }))).rejects.toMatchObject({ code: SubsonicErrorCode.NOT_FOUND })
    expect(await prisma.playlist.count({ where: { id: shared.id } })).toBe(1)
  })

  it('deletePlaylist 404s on another user\'s playlist', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    const bobsPlaylist = await makePlaylist(prisma, { userId: bob.id })

    await expect(deletePlaylist(NO_EVENT, ctxFor(alice, { id: bobsPlaylist.id }))).rejects.toMatchObject({ code: SubsonicErrorCode.NOT_FOUND })
    expect(await prisma.playlist.count({ where: { id: bobsPlaylist.id } })).toBe(1)
  })
})
