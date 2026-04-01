import { randomBytes } from 'node:crypto'

// In-memory session store — single-user personal app, no persistence needed
const sessions = new Set<string>()

export function createSession(): string {
  const token = randomBytes(32).toString('hex')
  sessions.add(token)
  return token
}

export function validateSession(token: string | undefined): boolean {
  if (!token) return false
  return sessions.has(token)
}

export function destroySession(token: string): void {
  sessions.delete(token)
}
