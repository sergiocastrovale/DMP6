import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkProwlarrConnection,
  prowlarrRtLimited,
  prowlarrSearch,
  clearProwlarrConfigCache,
} from '../../../server/utils/prowlarr'
import type { ProwlarrRelease } from '../../../types/download'

const settingsMock = vi.hoisted(() => ({
  resolveDownloadSettings: vi.fn(),
}))

vi.mock('~/server/utils/downloadSettings', () => ({
  resolveDownloadSettings: settingsMock.resolveDownloadSettings,
}))

const configured = () => settingsMock.resolveDownloadSettings.mockResolvedValue({
  prowlarrUrl: 'http://prowlarr.local:9696',
  prowlarrApiKey: 'key123',
  prowlarrIndexerId: '5',
})

const unconfigured = () => settingsMock.resolveDownloadSettings.mockResolvedValue({
  prowlarrUrl: '',
  prowlarrApiKey: '',
  prowlarrIndexerId: '',
})

const jsonResponse = (body: unknown, status = 200): Response => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
} as unknown as Response)

describe('checkProwlarrConnection', () => {
  afterEach(() => {
    clearProwlarrConfigCache()
    vi.unstubAllGlobals()
  })

  it('reports unconfigured when the URL or API key is missing', async () => {
    unconfigured()

    const result = await checkProwlarrConnection()

    expect(result).toEqual({ ok: false, error: 'Prowlarr URL or API key not configured' })
  })

  it('reports connected on a healthy /health response', async () => {
    configured()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({})))

    const result = await checkProwlarrConnection()

    expect(result).toEqual({ ok: true })
  })

  it('surfaces the API error message on a failed request', async () => {
    configured()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('boom', 500)))

    const result = await checkProwlarrConnection()

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Prowlarr API error: 500/)
  })
})

describe('prowlarrRtLimited', () => {
  afterEach(() => {
    clearProwlarrConfigCache()
    vi.unstubAllGlobals()
  })

  it('is true when the recent log mentions the query limit', async () => {
    configured()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      records: [{ message: 'Indexer RuTracker refused: exceeding the maximum query limit of 25' }],
    })))

    expect(await prowlarrRtLimited()).toBe(true)
  })

  it('is false when the log has no matching entries', async () => {
    configured()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ records: [{ message: 'all good' }] })))

    expect(await prowlarrRtLimited()).toBe(false)
  })

  it('is false when the request itself fails', async () => {
    configured()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    expect(await prowlarrRtLimited()).toBe(false)
  })
})

describe('prowlarrSearch', () => {
  afterEach(() => {
    clearProwlarrConfigCache()
    vi.unstubAllGlobals()
  })

  it('returns an empty list when Prowlarr is not configured', async () => {
    unconfigured()

    expect(await prowlarrSearch('some album')).toEqual([])
  })

  const release = (overrides: Partial<ProwlarrRelease> = {}): ProwlarrRelease => ({
    title: 'Artist - Album [FLAC]',
    size: 500_000_000,
    seeders: 10,
    leechers: 1,
    magnetUrl: 'magnet:?xt=urn:btih:abc',
    downloadUrl: undefined,
    guid: 'guid-1',
    infoHash: 'abc',
    indexer: 'RuTracker',
    protocol: 'torrent',
    ...overrides,
  })

  it('maps releases, guesses format from the title, and sorts by seeders desc', async () => {
    configured()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([
      release({ title: 'Low Seed [MP3]', seeders: 2 }),
      release({ title: 'High Seed [FLAC]', seeders: 50 }),
    ])))

    const results = await prowlarrSearch('some album')

    expect(results.map(r => r.title)).toEqual(['High Seed [FLAC]', 'Low Seed [MP3]'])
    expect(results[0]).toMatchObject({ format: 'FLAC', downloadUrl: 'magnet:?xt=urn:btih:abc' })
    expect(results[1]).toMatchObject({ format: 'MP3' })
  })

  it('drops non-torrent protocol results and results with no usable download url', async () => {
    configured()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([
      release({ protocol: 'usenet' }),
      release({ magnetUrl: undefined, downloadUrl: undefined, guid: '' }),
    ])))

    expect(await prowlarrSearch('some album')).toEqual([])
  })

  it('returns an empty list when the response is not an array', async () => {
    configured()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ not: 'an array' })))

    expect(await prowlarrSearch('some album')).toEqual([])
  })
})
