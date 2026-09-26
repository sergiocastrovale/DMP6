import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeUser } from '../../../test/factories'
import { deleteUserLastfmSession, getUserLastfmSession, saveUserLastfmSession } from '../../../server/utils/lastfmSessions'

// One Last.fm session per user, private like favorites: separate rows, replaced on reconnect, gone with the user.
const prisma = getTestPrisma()

describe('per-user Last.fm sessions (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('keeps each user\'s session separate', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    await saveUserLastfmSession(alice.id, { sessionKey: 'a-key', username: 'alice_fm' })

    expect(await getUserLastfmSession(alice.id)).toEqual({ sessionKey: 'a-key', username: 'alice_fm' })
    expect(await getUserLastfmSession(bob.id)).toBeNull()
  })

  it('a reconnect replaces the session instead of adding a second one', async () => {
    const alice = await makeUser(prisma)
    await saveUserLastfmSession(alice.id, { sessionKey: 'old', username: 'one' })
    await saveUserLastfmSession(alice.id, { sessionKey: 'new', username: 'two' })

    expect(await getUserLastfmSession(alice.id)).toEqual({ sessionKey: 'new', username: 'two' })
    expect(await prisma.userLastfmSession.count()).toBe(1)
  })

  it('disconnect only removes the caller\'s own session', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    await saveUserLastfmSession(alice.id, { sessionKey: 'a', username: 'a' })
    await saveUserLastfmSession(bob.id, { sessionKey: 'b', username: 'b' })

    await deleteUserLastfmSession(alice.id)

    expect(await getUserLastfmSession(alice.id)).toBeNull()
    expect(await getUserLastfmSession(bob.id)).not.toBeNull()
  })

  it('dies with the user', async () => {
    const alice = await makeUser(prisma)
    await saveUserLastfmSession(alice.id, { sessionKey: 'a', username: 'a' })

    await prisma.user.delete({ where: { id: alice.id } })

    expect(await prisma.userLastfmSession.count()).toBe(0)
  })
})
