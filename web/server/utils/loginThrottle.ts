import type { LoginThrottleEntry } from '~/types/auth'

// In-memory per-(username+IP) login throttle. Personal single-instance app — no Redis needed.
const attempts = new Map<string, LoginThrottleEntry>()

const MAX_FREE_ATTEMPTS = 5
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 60_000

export const isLoginLocked = (key: string): boolean => {
  const entry = attempts.get(key)
  return !!entry && entry.lockedUntil > Date.now()
}

export const registerLoginFailure = (key: string): void => {
  const entry = attempts.get(key) ?? { failures: 0, lockedUntil: 0 }
  entry.failures += 1
  if (entry.failures > MAX_FREE_ATTEMPTS) {
    const backoffSteps = entry.failures - MAX_FREE_ATTEMPTS
    entry.lockedUntil = Date.now() + Math.min(BASE_DELAY_MS * 2 ** backoffSteps, MAX_DELAY_MS)
  }
  attempts.set(key, entry)
}

export const clearLoginFailures = (key: string): void => {
  attempts.delete(key)
}
