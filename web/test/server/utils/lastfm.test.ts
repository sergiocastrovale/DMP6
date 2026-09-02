import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  describeLastfmProblem, isLastfmConfigured, signRequest,
  callLastFm, getAuthUrl, getLastfmSession,
} from '../../../server/utils/lastfm'
import type { LastfmSettings } from '../../../types/api'

vi.mock('~/server/utils/monitorLog', () => ({ monitorLog: vi.fn() }))

const jsonResponse = (body: unknown): Response => ({ json: async () => body } as unknown as Response)

const settings = (overrides: Partial<LastfmSettings> = {}): LastfmSettings => ({
  lastfmApiKey: 'key', lastfmSecret: 'secret', lastfmSessionKey: 'session', lastfmUsername: null,
  ...overrides,
})

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

describe('getAuthUrl', () => {
  it('builds the Last.fm auth URL with URL-encoded params', () => {
    expect(getAuthUrl('my key', 'https://dmp.local/callback?x=1'))
      .toBe('https://www.last.fm/api/auth/?api_key=my%20key&cb=https%3A%2F%2Fdmp.local%2Fcallback%3Fx%3D1')
  })
})

describe('callLastFm', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns null without a request when Last.fm is not configured', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await callLastFm('track.scrobble', {}, settings({ lastfmApiKey: null }))

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('POSTs a signed request and returns the parsed JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ scrobbles: { '@attr': { ignored: '0' } } })))

    const result = await callLastFm('track.scrobble', { artist: 'A' }, settings())

    expect(result).toEqual({ scrobbles: { '@attr': { ignored: '0' } } })
  })

  it('logs and returns null when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    const result = await callLastFm('track.scrobble', {}, settings())

    expect(result).toBeNull()
  })
})

describe('getLastfmSession', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns the session key and username on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ session: { key: 'sk', name: 'kp' } })))

    const result = await getLastfmSession('tok', 'key', 'secret')

    expect(result).toEqual({ sessionKey: 'sk', username: 'kp' })
  })

  it('returns null when the response has no session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 4, message: 'bad token' })))

    expect(await getLastfmSession('tok', 'key', 'secret')).toBeNull()
  })

  it('returns null when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    expect(await getLastfmSession('tok', 'key', 'secret')).toBeNull()
  })
})
