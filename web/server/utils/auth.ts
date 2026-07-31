import { createHmac, timingSafeEqual } from 'node:crypto'
import { SESSION_MAX_AGE_SECONDS } from '~/helpers/constants'
import { prisma } from '~/server/utils/prisma'
import { invalidateAuthUserCache } from '~/server/utils/userCache'

const TTL = SESSION_MAX_AGE_SECONDS * 1000

if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET required in production')
}

const SECRET = process.env.SESSION_SECRET ?? 'dmp-insecure-dev-secret'

type Payload = { userId: number; exp: number; ph: string; tv: number }

const phash = (passwordHash: string): string =>
  createHmac('sha256', SECRET).update(passwordHash).digest('hex').slice(0, 16)

const encode = (obj: object): string => {
  const data = Buffer.from(JSON.stringify(obj)).toString('base64url')
  const sig = createHmac('sha256', SECRET).update(data).digest('base64url')
  return `${data}.${sig}`
}

const decode = (token: string): Payload | null => {
  const i = token.lastIndexOf('.')
  if (i === -1) return null
  const data = token.slice(0, i)
  const sigBuf = Buffer.from(token.slice(i + 1), 'base64url')
  const expected = Buffer.from(createHmac('sha256', SECRET).update(data).digest('base64url'), 'base64url')
  if (sigBuf.length !== expected.length) return null
  try {
    if (!timingSafeEqual(sigBuf, expected)) return null
    return JSON.parse(Buffer.from(data, 'base64url').toString()) as Payload
  }
  catch {
    return null
  }
}

export const createSession = (userId: number, passwordHash: string, tokenVersion: number): string =>
  encode({ userId, exp: Date.now() + TTL, ph: phash(passwordHash), tv: tokenVersion })

export const validateSession = (token: string | undefined): Payload | null => {
  if (!token) return null
  const p = decode(token)
  return p && p.exp > Date.now() ? p : null
}

export const isSessionStaleForUser = (
  token: string | undefined,
  passwordHash: string,
  tokenVersion: number,
): boolean => {
  const p = validateSession(token)
  return !p || p.ph !== phash(passwordHash) || p.tv !== tokenVersion
}

// Stateless HMAC tokens can't be revoked individually - revoking means bumping the user's tokenVersion,
// which invalidates every token issued before the bump (checked in isSessionStaleForUser above).
export const destroyUserSessions = async (userId: number): Promise<void> => {
  await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } }).catch(() => {})
  // Don't wait out the 30s auth-user cache TTL to see the revoke - a stale cache entry would keep
  // validating the very token this call is supposed to kill.
  invalidateAuthUserCache(userId)
}

export const destroySession = async (token: string): Promise<void> => {
  const session = validateSession(token)
  if (session) await destroyUserSessions(session.userId)
}
