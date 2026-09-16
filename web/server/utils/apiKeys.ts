// Per-user API keys, the only credential the Subsonic (/rest/*) API accepts (see
// docs/feature_subsonic.md - bcrypt-hashed passwords can't support Subsonic's classic
// t=md5(password+salt) scheme). Stored as a sha256 hex digest so a check needs no KDF work on
// every /rest/* request, unlike password.ts's bcrypt (deliberately slow, checked once per login).
import { randomBytes, createHash } from 'node:crypto'
import { prisma } from '~/server/utils/prisma'
import type { SessionUser } from '~/types/auth'

const KEY_PREFIX = 'dmp_'
const PREFIX_DISPLAY_LEN = 8
// How often a matched key's lastUsedAt is allowed to be written - every /rest/* call would otherwise
// issue an UPDATE per request; a 5-minute floor keeps the write rate sane without hiding staleness.
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000

export const generateApiKey = (): string => `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`

export const hashApiKey = (key: string): string => createHash('sha256').update(key).digest('hex')

export interface ApiKeySummary {
  id: string
  name: string
  prefix: string
  createdAt: Date
  lastUsedAt: Date | null
  revokedAt: Date | null
}

export const listApiKeys = (userId: number): Promise<ApiKeySummary[]> =>
  prisma.userApiKey.findMany({
    where: { userId },
    select: { id: true, name: true, prefix: true, createdAt: true, lastUsedAt: true, revokedAt: true },
    orderBy: { createdAt: 'desc' },
  })

export const createApiKey = async (userId: number, name: string): Promise<{ id: string, key: string }> => {
  const key = generateApiKey()
  const created = await prisma.userApiKey.create({
    data: {
      userId,
      name,
      keyHash: hashApiKey(key),
      prefix: key.slice(0, PREFIX_DISPLAY_LEN),
    },
    select: { id: true },
  })
  return { id: created.id, key }
}

// Scoped to the caller's own keys - anything else, or an unknown id, 404s rather than leaking
// which ids exist for another user (same contract as findOwnManualPlaylist).
export const revokeApiKey = async (userId: number, id: string): Promise<void> => {
  const result = await prisma.userApiKey.updateMany({
    where: { id, userId, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  if (result.count === 0) {
    throw createError({ statusCode: 404, statusMessage: 'API key not found' })
  }
}

// Resolves a plaintext apiKey to its owning user, or null for missing/revoked/unknown. Mirrors the
// shape server/middleware/auth.ts puts on event.context.user.
export const resolveApiKey = async (key: string): Promise<SessionUser | null> => {
  const row = await prisma.userApiKey.findUnique({
    where: { keyHash: hashApiKey(key) },
    select: {
      id: true,
      revokedAt: true,
      lastUsedAt: true,
      user: { select: { id: true, username: true, email: true, role: true, mustChangePassword: true } },
    },
  })
  if (!row || row.revokedAt) {return null}

  const now = Date.now()
  if (!row.lastUsedAt || now - row.lastUsedAt.getTime() > LAST_USED_WRITE_INTERVAL_MS) {
    // Fire-and-forget - a lost update to lastUsedAt must never fail the request it's timestamping.
    prisma.userApiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {})
  }

  return row.user
}
