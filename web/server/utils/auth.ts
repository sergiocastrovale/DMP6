import { createHmac, timingSafeEqual } from 'node:crypto'

const TTL = 7 * 24 * 60 * 60 * 1000
const SECRET = process.env.SESSION_SECRET ?? 'dmp-insecure-dev-secret'

type Payload = { userId: number; exp: number; ph: string }

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

export const createSession = (userId: number, passwordHash: string): string =>
  encode({ userId, exp: Date.now() + TTL, ph: phash(passwordHash) })

export const validateSession = (token: string | undefined): Payload | null => {
  if (!token) return null
  const p = decode(token)
  return p && p.exp > Date.now() ? p : null
}

export const isSessionStaleForUser = (token: string | undefined, passwordHash: string): boolean => {
  const p = validateSession(token)
  return !p || p.ph !== phash(passwordHash)
}

export const destroySession = (_token: string): void => {}
export const destroyUserSessions = (_userId: number): void => {}
