import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { clearLoginFailures, isLoginLocked, registerLoginFailure } from '../../../server/utils/loginThrottle'

describe('loginThrottle', () => {
  it('is not locked before any failures', () => {
    const key = randomUUID()
    expect(isLoginLocked(key)).toBe(false)
  })

  it('stays unlocked for a handful of failures under the free-attempt threshold', () => {
    const key = randomUUID()
    for (let i = 0; i < 5; i++) registerLoginFailure(key)
    expect(isLoginLocked(key)).toBe(false)
  })

  it('locks out once failures cross the threshold', () => {
    const key = randomUUID()
    for (let i = 0; i < 6; i++) registerLoginFailure(key)
    expect(isLoginLocked(key)).toBe(true)
  })

  it('clearLoginFailures resets the lock', () => {
    const key = randomUUID()
    for (let i = 0; i < 6; i++) registerLoginFailure(key)
    expect(isLoginLocked(key)).toBe(true)
    clearLoginFailures(key)
    expect(isLoginLocked(key)).toBe(false)
  })

  it('tracks separate keys independently (per username+IP)', () => {
    const a = randomUUID()
    const b = randomUUID()
    for (let i = 0; i < 6; i++) registerLoginFailure(a)
    expect(isLoginLocked(a)).toBe(true)
    expect(isLoginLocked(b)).toBe(false)
  })
})
