import { prisma } from '~/server/utils/prisma'
import type { CachedAuthUser } from '~/types/auth'

// Per-request auth middleware hit before this cache: 1 User lookup EVERY request (every audio range
// chunk, every downloads-page poll tick). This trades a small staleness window (role/email changes,
// same as settingsCache.ts's precedent) for cutting that to ~once per 30s per active user. Anything
// security-sensitive (password change, logout/session-revoke, user delete) explicitly invalidates
// instead of waiting out the TTL - see invalidateAuthUserCache callers.

const CACHE_TTL = 30_000

const cache = new Map<number, { user: CachedAuthUser | null, expiry: number }>()

export async function getCachedAuthUser(userId: number): Promise<CachedAuthUser | null> {
  const entry = cache.get(userId)
  if (entry && Date.now() < entry.expiry) {return entry.user}

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      role: true,
      mustChangePassword: true,
      passwordHash: true,
      tokenVersion: true,
    },
  })
  cache.set(userId, { user, expiry: Date.now() + CACHE_TTL })
  return user
}

export function invalidateAuthUserCache(userId: number): void {
  cache.delete(userId)
}
