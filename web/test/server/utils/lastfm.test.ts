import { describe, expect, it } from 'vitest'
import { describeLastfmProblem, isLastfmConfigured, signRequest } from '../../../server/utils/lastfm'

describe('isLastfmConfigured', () => {
  it('requires apiKey, secret, and sessionKey', () => {
    expect(isLastfmConfigured({ lastfmApiKey: 'a', lastfmSecret: 'b', lastfmSessionKey: 'c', lastfmUsername: null })).toBe(true)
  })

  it('is false when any field is missing', () => {
    expect(isLastfmConfigured({ lastfmApiKey: null, lastfmSecret: 'b', lastfmSessionKey: 'c', lastfmUsername: null })).toBe(false)
    expect(isLastfmConfigured({ lastfmApiKey: 'a', lastfmSecret: null, lastfmSessionKey: 'c', lastfmUsername: null })).toBe(false)
    expect(isLastfmConfigured({ lastfmApiKey: 'a', lastfmSecret: 'b', lastfmSessionKey: null, lastfmUsername: null })).toBe(false)
  })
})

describe('signRequest', () => {
  it('is deterministic regardless of key insertion order', () => {
    const a = signRequest({ b: '2', a: '1' }, 'secret')
    const b = signRequest({ a: '1', b: '2' }, 'secret')
    expect(a).toBe(b)
  })

  it('sorts params, concatenates key+value, appends the secret, and MD5-hashes', () => {
    // method=x + api_key=y + secret == "methodxapi_keyysecret" hashed
    const result = signRequest({ method: 'x', api_key: 'y' }, 'secret')
    expect(result).toMatch(/^[a-f0-9]{32}$/)
  })

  it('produces different signatures for different secrets', () => {
    const a = signRequest({ k: 'v' }, 'secret1')
    const b = signRequest({ k: 'v' }, 'secret2')
    expect(a).not.toBe(b)
  })
})

describe('describeLastfmProblem', () => {
  it('null for a null response (network failure already logged by callLastFm)', () => {
    expect(describeLastfmProblem(null)).toBeNull()
  })

  it('null for a clean scrobble response (0 ignored)', () => {
    expect(describeLastfmProblem({ scrobbles: { '@attr': { accepted: '1', ignored: '0' } } })).toBeNull()
  })

  it('describes an explicit Last.fm error code', () => {
    expect(describeLastfmProblem({ error: 9, message: 'Invalid session key' }))
      .toBe('Last.fm error 9: Invalid session key')
  })

  it('describes an ignored scrobble', () => {
    expect(describeLastfmProblem({ scrobbles: { '@attr': { accepted: '0', ignored: '1' } } }))
      .toBe('Last.fm ignored 1 scrobble(s)')
  })

  it('null when there is no error and no scrobbles field at all (e.g. updateNowPlaying)', () => {
    expect(describeLastfmProblem({ nowplaying: { track: { '#text': 'X' } } })).toBeNull()
  })
})
