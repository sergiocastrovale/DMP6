import { describe, expect, it } from 'vitest'
import { createOAuthState, oauthStatesMatch } from '../../../server/utils/oauthState'

describe('oauth state', () => {
  it('mints unguessable, URL-safe, distinct nonces', () => {
    const a = createOAuthState()
    const b = createOAuthState()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/)
  })

  it('accepts only an identical URL and cookie value', () => {
    const state = createOAuthState()
    expect(oauthStatesMatch(state, state)).toBe(true)
    expect(oauthStatesMatch(state, createOAuthState())).toBe(false)
  })

  it('rejects a missing side - a forged link has no cookie, a stale browser has no path nonce', () => {
    const state = createOAuthState()
    expect(oauthStatesMatch(state, undefined)).toBe(false)
    expect(oauthStatesMatch(undefined, state)).toBe(false)
    expect(oauthStatesMatch('', '')).toBe(false)
  })

  it('rejects values of different length without throwing', () => {
    expect(oauthStatesMatch('abc', 'abcd')).toBe(false)
  })
})
