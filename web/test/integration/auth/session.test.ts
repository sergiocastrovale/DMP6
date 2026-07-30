import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeUser } from '../../../test/factories'
import { createSession, isSessionStaleForUser, validateSession } from '../../../server/utils/auth'
import { hashPassword, verifyPassword } from '../../../server/utils/password'

const prisma = getTestPrisma()

describe('auth session lifecycle against a real User row', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('login flow: a real bcrypt hash verifies the correct password and rejects a wrong one', async () => {
    const hash = await hashPassword('correct-horse-battery-staple')
    const user = await makeUser(prisma, { passwordHash: hash })
    expect(await verifyPassword('correct-horse-battery-staple', user.passwordHash)).toBe(true)
    expect(await verifyPassword('wrong-password', user.passwordHash)).toBe(false)
  })

  it('a session created for one user validates against that user\'s current DB row', async () => {
    const user = await makeUser(prisma, { passwordHash: 'hash-a' })
    const token = createSession(user.id, user.passwordHash)
    const payload = validateSession(token)
    expect(payload?.userId).toBe(user.id)
    expect(isSessionStaleForUser(token, user.passwordHash)).toBe(false)
  })

  it('changing the password in the DB makes every previously-issued session stale', async () => {
    const user = await makeUser(prisma, { passwordHash: 'old-hash' })
    const token = createSession(user.id, user.passwordHash)

    const newHash = await hashPassword('a-new-password')
    const updated = await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } })

    expect(isSessionStaleForUser(token, updated.passwordHash)).toBe(true)
  })

  it('DOCUMENTED RISK: logout does not revoke the token server-side - it stays valid against the unchanged DB row until it expires', async () => {
    const user = await makeUser(prisma, { passwordHash: 'hash-a' })
    const token = createSession(user.id, user.passwordHash)

    // "Logout" in this app only deletes the client cookie - server/utils/auth.ts's destroySession is a
    // documented no-op. Simulate that: the DB row is untouched, so replaying the captured token still
    // validates as a live session.
    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(isSessionStaleForUser(token, dbUser.passwordHash)).toBe(false)
    expect(validateSession(token)).not.toBeNull()
  })

  it('a fresh User row seeded by the test harness satisfies the unique username/email constraints', async () => {
    const a = await makeUser(prisma)
    const b = await makeUser(prisma)
    expect(a.username).not.toBe(b.username)
    expect(a.email).not.toBe(b.email)
  })
})
