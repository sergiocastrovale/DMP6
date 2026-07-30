import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('auth session crypto', () => {
  beforeEach(() => {
    vi.resetModules()
    process.env.SESSION_SECRET = 'fixed-test-secret'
  })

  afterEach(() => {
    delete process.env.SESSION_SECRET
    vi.useRealTimers()
  })

  it('roundtrips createSession -> validateSession', async () => {
    const { createSession, validateSession } = await import('../../../server/utils/auth')
    const token = createSession(42, 'hash-a')
    const payload = validateSession(token)
    expect(payload).not.toBeNull()
    expect(payload!.userId).toBe(42)
  })

  it('rejects a tampered payload', async () => {
    const { createSession, validateSession } = await import('../../../server/utils/auth')
    const token = createSession(1, 'hash')
    const [data, sig] = token.split('.')
    const tamperedPayload = Buffer.from(JSON.stringify({ userId: 999, exp: Date.now() + 1e9, ph: 'x' })).toString('base64url')
    expect(validateSession(`${tamperedPayload}.${sig}`)).toBeNull()
    void data
  })

  it('rejects a tampered signature', async () => {
    const { createSession, validateSession } = await import('../../../server/utils/auth')
    const token = createSession(1, 'hash')
    const [data] = token.split('.')
    expect(validateSession(`${data}.deadbeef`)).toBeNull()
  })

  it('rejects an expired token', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
    const { createSession, validateSession } = await import('../../../server/utils/auth')
    const token = createSession(1, 'hash')
    vi.setSystemTime(new Date('2024-04-15T00:00:00Z')) // > 90 days later
    expect(validateSession(token)).toBeNull()
  })

  it('rejects a malformed token (no separator)', async () => {
    const { validateSession } = await import('../../../server/utils/auth')
    expect(validateSession('not-a-real-token')).toBeNull()
  })

  it('returns null for undefined token', async () => {
    const { validateSession } = await import('../../../server/utils/auth')
    expect(validateSession(undefined)).toBeNull()
  })

  it('isSessionStaleForUser is true when the password hash changed', async () => {
    const { createSession, isSessionStaleForUser } = await import('../../../server/utils/auth')
    const token = createSession(1, 'old-hash')
    expect(isSessionStaleForUser(token, 'new-hash')).toBe(true)
  })

  it('isSessionStaleForUser is false when the password hash is unchanged', async () => {
    const { createSession, isSessionStaleForUser } = await import('../../../server/utils/auth')
    const token = createSession(1, 'same-hash')
    expect(isSessionStaleForUser(token, 'same-hash')).toBe(false)
  })

  it('isSessionStaleForUser is true for an undefined token', async () => {
    const { isSessionStaleForUser } = await import('../../../server/utils/auth')
    expect(isSessionStaleForUser(undefined, 'anything')).toBe(true)
  })

  it('destroySession/destroyUserSessions are no-ops (stateless sessions, documented risk)', async () => {
    const { createSession, validateSession, destroySession } = await import('../../../server/utils/auth')
    const token = createSession(1, 'hash')
    destroySession(token)
    // The token is still valid after "destroying" it - there is no server-side revocation.
    expect(validateSession(token)).not.toBeNull()
  })
})
