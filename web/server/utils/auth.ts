import { randomBytes } from 'node:crypto'

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

type SessionEntry = {
  userId: number
  createdAt: number
}

const sessions = new Map<string, SessionEntry>()

export const createSession = (userId: number): string => {
  const token = randomBytes(32).toString('hex')
  sessions.set(token, { userId, createdAt: Date.now() })
  return token
}

export const validateSession = (token: string | undefined): SessionEntry | null => {
  if (!token) return null
  const entry = sessions.get(token)
  if (!entry) return null
  if (Date.now() - entry.createdAt > SESSION_TTL_MS) {
    sessions.delete(token)
    return null
  }
  return entry
}

export const destroySession = (token: string): void => {
  sessions.delete(token)
}

export const destroyUserSessions = (userId: number): void => {
  for (const [token, entry] of sessions) {
    if (entry.userId === userId) sessions.delete(token)
  }
}

setInterval(() => {
  const now = Date.now()
  for (const [token, entry] of sessions) {
    if (now - entry.createdAt > SESSION_TTL_MS) sessions.delete(token)
  }
}, 60_000)
