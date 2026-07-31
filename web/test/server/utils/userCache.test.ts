import { beforeEach, describe, expect, it, vi } from 'vitest'

const findUniqueMock = vi.fn()

vi.mock('~/server/utils/prisma', () => ({
  prisma: { user: { findUnique: (...args: unknown[]) => findUniqueMock(...args) } },
}))

const dbUser = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 1, username: 'kp', email: 'kp@test.local', role: 'ADMIN',
  mustChangePassword: false, passwordHash: 'hash-a', tokenVersion: 0,
  ...overrides,
})

describe('userCache', () => {
  beforeEach(async () => {
    vi.resetModules()
    vi.useRealTimers()
    findUniqueMock.mockReset()
    const { invalidateAuthUserCache } = await import('../../../server/utils/userCache')
    invalidateAuthUserCache(1)
  })

  it('fetches from the DB on a cache miss', async () => {
    findUniqueMock.mockResolvedValue(dbUser())
    const { getCachedAuthUser } = await import('../../../server/utils/userCache')
    const user = await getCachedAuthUser(1)
    expect(user?.username).toBe('kp')
    expect(findUniqueMock).toHaveBeenCalledOnce()
  })

  it('serves subsequent lookups from cache without hitting the DB again', async () => {
    findUniqueMock.mockResolvedValue(dbUser())
    const { getCachedAuthUser } = await import('../../../server/utils/userCache')
    await getCachedAuthUser(1)
    await getCachedAuthUser(1)
    await getCachedAuthUser(1)
    expect(findUniqueMock).toHaveBeenCalledOnce()
  })

  it('refetches once the TTL expires', async () => {
    vi.useFakeTimers()
    findUniqueMock.mockResolvedValue(dbUser())
    const { getCachedAuthUser } = await import('../../../server/utils/userCache')
    await getCachedAuthUser(1)
    vi.advanceTimersByTime(31_000)
    await getCachedAuthUser(1)
    expect(findUniqueMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('invalidateAuthUserCache forces an immediate refetch, bypassing the TTL - this is what makes logout/password-change/role-change take effect right away', async () => {
    findUniqueMock.mockResolvedValue(dbUser())
    const { getCachedAuthUser, invalidateAuthUserCache } = await import('../../../server/utils/userCache')
    await getCachedAuthUser(1)
    invalidateAuthUserCache(1)
    findUniqueMock.mockResolvedValue(dbUser({ tokenVersion: 1 }))
    const user = await getCachedAuthUser(1)
    expect(user?.tokenVersion).toBe(1)
    expect(findUniqueMock).toHaveBeenCalledTimes(2)
  })

  it('caches a null result too (deleted user) without hammering the DB', async () => {
    findUniqueMock.mockResolvedValue(null)
    const { getCachedAuthUser } = await import('../../../server/utils/userCache')
    expect(await getCachedAuthUser(1)).toBeNull()
    expect(await getCachedAuthUser(1)).toBeNull()
    expect(findUniqueMock).toHaveBeenCalledOnce()
  })
})
