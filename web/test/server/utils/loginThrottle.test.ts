import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { _resetThrottleForTest, clearLoginFailures, isLoginLocked, MAX_THROTTLE_ENTRIES, registerLoginFailure, throttleSize } from '../../../server/utils/loginThrottle'

describe('loginThrottle', () => {
  it('is not locked before any failures', () => {
    const key = randomUUID()
    expect(isLoginLocked(key)).toBe(false)
  })

  it('stays unlocked for a handful of failures under the free-attempt threshold', () => {
    const key = randomUUID()
    for (let i = 0; i < 5; i++) {registerLoginFailure(key)}
    expect(isLoginLocked(key)).toBe(false)
  })

  it('locks out once failures cross the threshold', () => {
    const key = randomUUID()
    for (let i = 0; i < 6; i++) {registerLoginFailure(key)}
    expect(isLoginLocked(key)).toBe(true)
  })

  it('clearLoginFailures resets the lock', () => {
    const key = randomUUID()
    for (let i = 0; i < 6; i++) {registerLoginFailure(key)}
    expect(isLoginLocked(key)).toBe(true)
    clearLoginFailures(key)
    expect(isLoginLocked(key)).toBe(false)
  })

  it('tracks separate keys independently (per username+IP)', () => {
    const a = randomUUID()
    const b = randomUUID()
    for (let i = 0; i < 6; i++) {registerLoginFailure(a)}
    expect(isLoginLocked(a)).toBe(true)
    expect(isLoginLocked(b)).toBe(false)
  })
})

describe('loginThrottle bounds', () => {
  beforeEach(() => _resetThrottleForTest())

  it('forgets keys with no recent failure', () => {
    const now = 1_000_000
    registerLoginFailure('old', now)
    // Push the map past the prune threshold with fresh keys well after the idle window.
    const later = now + 20 * 60_000
    for (let i = 0; i < 5100; i++) {registerLoginFailure(`k${i}`, later)}
    // 'old' failed once, 20 minutes before - expired by the prune that ran while adding the others.
    expect(isLoginLocked('old', later)).toBe(false)
    expect(throttleSize()).toBe(5100)
  })

  it('never tracks more than the hard ceiling, evicting the oldest keys', () => {
    const now = 5_000_000
    for (let i = 0; i < MAX_THROTTLE_ENTRIES + 500; i++) {registerLoginFailure(`spray-${i}`, now)}
    expect(throttleSize()).toBeLessThanOrEqual(MAX_THROTTLE_ENTRIES)
  })
})
