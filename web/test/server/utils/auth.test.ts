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
    const token = createSession(42, 'hash-a', 0)
    const payload = validateSession(token)
    expect(payload).not.toBeNull()
    expect(payload!.userId).toBe(42)
  })

  it('rejects a tampered payload', async () => {
    const { createSession, validateSession } = await import('../../../server/utils/auth')
    const token = createSession(1, 'hash', 0)
    const [data, sig] = token.split('.')
    const tamperedPayload = Buffer.from(JSON.stringify({ userId: 999, exp: Date.now() + 1e9, ph: 'x', tv: 0 })).toString('base64url')
    expect(validateSession(`${tamperedPayload}.${sig}`)).toBeNull()
    void data
  })

  it('rejects a tampered signature', async () => {
    const { createSession, validateSession } = await import('../../../server/utils/auth')
    const token = createSession(1, 'hash', 0)
    const [data] = token.split('.')
    expect(validateSession(`${data}.deadbeef`)).toBeNull()
  })

  it('rejects an expired token', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'))
    const { createSession, validateSession } = await import('../../../server/utils/auth')
    const token = createSession(1, 'hash', 0)
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
    const token = createSession(1, 'old-hash', 0)
    expect(isSessionStaleForUser(token, 'new-hash', 0)).toBe(true)
  })

  it('isSessionStaleForUser is false when the password hash and tokenVersion are unchanged', async () => {
    const { createSession, isSessionStaleForUser } = await import('../../../server/utils/auth')
    const token = createSession(1, 'same-hash', 0)
    expect(isSessionStaleForUser(token, 'same-hash', 0)).toBe(false)
  })

  it('isSessionStaleForUser is true when tokenVersion advanced (explicit revoke) even with the same password hash', async () => {
    // This is the logout/revoke mechanism: bumping tokenVersion invalidates every token issued before
    // the bump, without needing a password change.
    const { createSession, isSessionStaleForUser } = await import('../../../server/utils/auth')
    const token = createSession(1, 'same-hash', 0)
    expect(isSessionStaleForUser(token, 'same-hash', 1)).toBe(true)
  })

  it('isSessionStaleForUser is true for an undefined token', async () => {
    const { isSessionStaleForUser } = await import('../../../server/utils/auth')
    expect(isSessionStaleForUser(undefined, 'anything', 0)).toBe(true)
  })
})
