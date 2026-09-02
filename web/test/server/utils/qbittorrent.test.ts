import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isQbitComplete,
  isQbitErrored,
  checkQbittorrentConnection,
  getTorrentInfo,
  getTorrentFiles,
  setFilePriorities,
  deleteTorrent,
  clearQbitSession,
} from '../../../server/utils/qbittorrent'
import type { QbitTorrentInfo } from '../../../types/download'

vi.mock('~/server/utils/downloadSettings', () => ({
  resolveDownloadSettings: vi.fn().mockResolvedValue({
    qbittorrentUrl: 'http://qbit.local:8080',
    qbittorrentUser: 'admin',
    qbittorrentPass: 'admin',
  }),
}))

const info = (overrides: Partial<QbitTorrentInfo> = {}): QbitTorrentInfo => ({
  hash: 'h', name: 'n', state: 'downloading', progress: 0, size: 100, completed: 0, downloaded: 0, tags: '',
  ...overrides,
})

describe('isQbitComplete', () => {
  it('is true for known done states', () => {
    for (const state of ['uploading', 'stalledUP', 'queuedUP', 'forcedUP', 'pausedUP', 'stoppedUP', 'checkingUP']) {
      expect(isQbitComplete(info({ state }))).toBe(true)
    }
  })

  it('is true when progress reaches 1 regardless of state', () => {
    expect(isQbitComplete(info({ state: 'downloading', progress: 1 }))).toBe(true)
  })

  it('is false for an in-progress download below 100%', () => {
    expect(isQbitComplete(info({ state: 'downloading', progress: 0.5 }))).toBe(false)
  })
})

describe('isQbitErrored', () => {
  it('recognizes error and missingFiles states', () => {
    expect(isQbitErrored(info({ state: 'error' }))).toBe(true)
    expect(isQbitErrored(info({ state: 'missingFiles' }))).toBe(true)
  })

  it('is false otherwise', () => {
    expect(isQbitErrored(info({ state: 'downloading' }))).toBe(false)
  })
})

describe('network calls (mocked fetch)', () => {
  afterEach(() => {
    clearQbitSession()
    vi.unstubAllGlobals()
  })

  const stubFetch = (impl: (url: string, init?: RequestInit) => Promise<Response> | Response) => {
    vi.stubGlobal('fetch', vi.fn(impl))
  }

  // happy-dom's fetch strips Set-Cookie like a real browser would, so a genuine Response can't carry
  // it back to the client - fake the shape qbittorrent.ts actually reads instead.
  const loginResponse = (): Response => ({
    ok: true,
    status: 200,
    text: async () => '',
    headers: { getSetCookie: () => ['SID=abc123; Path=/'], get: () => null },
  } as unknown as Response)

  it('logs in then queries version to confirm the connection', async () => {
    stubFetch((url) => {
      if (String(url).includes('/auth/login')) {return loginResponse()}
      if (String(url).includes('/app/version')) {return new Response('v5.0.0', { status: 200 })}
      throw new Error(`unexpected url ${url}`)
    })

    const result = await checkQbittorrentConnection()

    expect(result).toEqual({ ok: true })
  })

  it('reports a rejected login as bad credentials', async () => {
    stubFetch((url) => {
      if (String(url).includes('/auth/login')) {return new Response('Fails.', { status: 200 })}
      throw new Error(`unexpected url ${url}`)
    })

    const result = await checkQbittorrentConnection()

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/bad credentials/i)
  })

  it('retries once with a fresh session on a 403, then succeeds', async () => {
    let loginCalls = 0
    stubFetch((url) => {
      const u = String(url)
      if (u.includes('/auth/login')) {
        loginCalls++
        return loginResponse()
      }
      if (u.includes('/torrents/info')) {
        // First call with the stale session fails; the retry succeeds.
        return loginCalls < 2
          ? new Response('', { status: 403 })
          : new Response(JSON.stringify([{ hash: 'h1', name: 'Album', state: 'uploading', progress: 1, size: 10, completed: 10, downloaded: 10, tags: 'dmp' }]), { status: 200 })
      }
      throw new Error(`unexpected url ${u}`)
    })

    const result = await getTorrentInfo(['h1'])

    expect(loginCalls).toBe(2)
    expect(result).toEqual([{ hash: 'h1', name: 'Album', state: 'uploading', progress: 1, size: 10, completed: 10, downloaded: 10, tags: 'dmp' }])
  })

  it('returns an empty array without a request when no hashes are given', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const result = await getTorrentInfo([])

    expect(result).toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('defaults a missing file index to its array position', async () => {
    stubFetch((url) => {
      const u = String(url)
      if (u.includes('/auth/login')) {return loginResponse()}
      if (u.includes('/torrents/files')) {
        return new Response(JSON.stringify([{ name: 'a.flac', size: 1 }, { name: 'b.flac', size: 2 }]), { status: 200 })
      }
      throw new Error(`unexpected url ${u}`)
    })

    const files = await getTorrentFiles('h1')

    expect(files).toEqual([
      { index: 0, name: 'a.flac', size: 1, progress: 0, priority: 1 },
      { index: 1, name: 'b.flac', size: 2, progress: 0, priority: 1 },
    ])
  })

  it('does nothing when asked to set priorities on an empty index list', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await setFilePriorities('h1', [], 0)

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('swallows a failed delete request', async () => {
    stubFetch((url) => {
      const u = String(url)
      if (u.includes('/auth/login')) {return loginResponse()}
      if (u.includes('/torrents/delete')) {return new Response('', { status: 500 })}
      throw new Error(`unexpected url ${u}`)
    })

    await expect(deleteTorrent('h1')).resolves.toBeUndefined()
  })
})
