import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeUser } from '../../../test/factories'
import { createSession, destroySession, destroyUserSessions, isSessionStaleForUser, validateSession } from '../../../server/utils/auth'
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from '../../../server/utils/password'

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
    const token = createSession(user.id, user.passwordHash, user.tokenVersion)
    const payload = validateSession(token)
    expect(payload?.userId).toBe(user.id)
    expect(isSessionStaleForUser(token, user.passwordHash, user.tokenVersion)).toBe(false)
  })

  it('changing the password in the DB makes every previously-issued session stale', async () => {
    const user = await makeUser(prisma, { passwordHash: 'old-hash' })
    const token = createSession(user.id, user.passwordHash, user.tokenVersion)

    const newHash = await hashPassword('a-new-password')
    const updated = await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } })

    expect(isSessionStaleForUser(token, updated.passwordHash, updated.tokenVersion)).toBe(true)
  })

  it('logout (destroySession) revokes the token server-side by bumping tokenVersion - the captured token stops validating immediately', async () => {
    const user = await makeUser(prisma, { passwordHash: 'hash-a' })
    const token = createSession(user.id, user.passwordHash, user.tokenVersion)

    await destroySession(token)

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(dbUser.tokenVersion).toBe(user.tokenVersion + 1)
    expect(isSessionStaleForUser(token, dbUser.passwordHash, dbUser.tokenVersion)).toBe(true)
    // The token itself still decodes/hasn't expired - it's the tokenVersion mismatch that revokes it,
    // which is exactly what lets a stateless HMAC token be server-side revoked at all.
    expect(validateSession(token)).not.toBeNull()
  })

  it('destroyUserSessions revokes every token for a user (e.g. on forced password reset by an admin), independent of destroySession/logout', async () => {
    const user = await makeUser(prisma, { passwordHash: 'hash-a' })
    const tokenA = createSession(user.id, user.passwordHash, user.tokenVersion)
    const tokenB = createSession(user.id, user.passwordHash, user.tokenVersion)

    await destroyUserSessions(user.id)

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
    expect(isSessionStaleForUser(tokenA, dbUser.passwordHash, dbUser.tokenVersion)).toBe(true)
    expect(isSessionStaleForUser(tokenB, dbUser.passwordHash, dbUser.tokenVersion)).toBe(true)
  })

  it('DUMMY_PASSWORD_HASH never verifies against a real password — safe to compare an unknown username against it for timing parity', async () => {
    expect(await verifyPassword('correct-horse-battery-staple', DUMMY_PASSWORD_HASH)).toBe(false)
    expect(await verifyPassword('', DUMMY_PASSWORD_HASH)).toBe(false)
  })

  it('a fresh User row seeded by the test harness satisfies the unique username/email constraints', async () => {
    const a = await makeUser(prisma)
    const b = await makeUser(prisma)
    expect(a.username).not.toBe(b.username)
    expect(a.email).not.toBe(b.email)
  })
})
