import type { LoginThrottleEntry } from '~/types/auth'

// In-memory per-(username+IP) login throttle. Personal single-instance app — no Redis needed.
const attempts = new Map<string, LoginThrottleEntry>()

const MAX_FREE_ATTEMPTS = 5
const BASE_DELAY_MS = 1000
const MAX_DELAY_MS = 60_000
// A key nobody has failed on for this long is forgotten: sub-threshold failures never set `lockedUntil`, so
// without it a spray of one-off usernames would sit in the map forever.
const IDLE_EXPIRY_MS = 15 * 60_000
// Hard ceiling on tracked keys. An attacker can mint unlimited distinct keys (username x IP); oldest are
// evicted first, which at worst lets a long-idle offender start over.
export const MAX_THROTTLE_ENTRIES = 10_000

export const isLoginLocked = (key: string, now: number = Date.now()): boolean => {
  const entry = attempts.get(key)
  return !!entry && entry.lockedUntil > now
}

const prune = (now: number): void => {
  for (const [key, entry] of attempts) {
    if (now - entry.lastFailureAt > IDLE_EXPIRY_MS && entry.lockedUntil <= now) {
      attempts.delete(key)
    }
  }
  // Map iterates in insertion order, so the first keys are the oldest.
  for (const key of attempts.keys()) {
    if (attempts.size <= MAX_THROTTLE_ENTRIES) {
      break
    }
    attempts.delete(key)
  }
}

export const registerLoginFailure = (key: string, now: number = Date.now()): void => {
  const entry = attempts.get(key) ?? { failures: 0, lockedUntil: 0, lastFailureAt: now }
  entry.failures += 1
  entry.lastFailureAt = now
  if (entry.failures > MAX_FREE_ATTEMPTS) {
    const backoffSteps = entry.failures - MAX_FREE_ATTEMPTS
    entry.lockedUntil = now + Math.min(BASE_DELAY_MS * 2 ** backoffSteps, MAX_DELAY_MS)
  }
  // Re-inserted so a key that keeps failing counts as recent for eviction.
  attempts.delete(key)
  attempts.set(key, entry)
  if (attempts.size > MAX_THROTTLE_ENTRIES / 2) {
    prune(now)
  }
}

export const clearLoginFailures = (key: string): void => {
  attempts.delete(key)
}

export const throttleSize = (): number => attempts.size

// Test-only: the map is module state that would otherwise leak between cases.
export const _resetThrottleForTest = (): void => {
  attempts.clear()
}
