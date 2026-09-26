import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Each test re-imports the module fresh (vi.resetModules) so the module-level pacing state
// (lastRequestAt/queue) never leaks between tests.
const freshModule = async () => {
  vi.resetModules()
  return import('../../../server/utils/musicbrainz')
}

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

describe('mbFetch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('sends the DMP User-Agent', async () => {
    const { mbFetch } = await freshModule()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const promise = mbFetch('/artist?query=x&fmt=json')
    await vi.runAllTimersAsync()
    await promise

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/artist?query=x&fmt=json'),
      expect.objectContaining({ headers: { 'User-Agent': 'DMPv6/0.1.0 ( https://github.com/dmp )' }, signal: expect.any(AbortSignal) }),
    )
  })

  it('spaces two calls at least 1100ms apart', async () => {
    const { mbFetch } = await freshModule()
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}))
    vi.stubGlobal('fetch', fetchMock)

    const p1 = mbFetch('/a')
    await vi.runAllTimersAsync()
    await p1
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const p2 = mbFetch('/b')
    // Not enough time has passed - fetch shouldn't have fired the second call yet.
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(600)
    await p2
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('retries once after 2s on a 503, then succeeds', async () => {
    const { mbFetch } = await freshModule()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(503, {}))
      .mockResolvedValueOnce(jsonResponse(200, { count: 5 }))
    vi.stubGlobal('fetch', fetchMock)

    const promise = mbFetch('/release-group?query=x')
    await vi.runAllTimersAsync()
    const result = await promise

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ count: 5 })
  })

  it('throws on a non-503 error status', async () => {
    const { mbFetch } = await freshModule()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})))

    // No wait involved (first call in a fresh module) - assert directly so the rejection handler
    // attaches before the microtask queue can flag it unhandled.
    await expect(mbFetch('/artist?query=x')).rejects.toThrow('MusicBrainz 500')
  })
})

describe('searchArtists', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('maps MB artist search results to the row shape', async () => {
    const { searchArtists } = await freshModule()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, {
      artists: [{ id: 'mb-1', name: 'Radiohead', disambiguation: '', country: 'GB', type: 'Group' }],
    })))

    const promise = searchArtists('radiohead')
    await vi.runAllTimersAsync()
    const rows = await promise

    expect(rows).toEqual([{ mbid: 'mb-1', name: 'Radiohead', disambiguation: null, country: 'GB', type: 'Group' }])
  })
})
