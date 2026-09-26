import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchWithTimeout, isTimeoutError } from '../../../server/utils/fetchWithTimeout'

const res = (status: number) => ({ status, ok: status < 400, body: { cancel: async () => {} } }) as unknown as Response

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('fetchWithTimeout', () => {
  it('passes the response through and gives fetch a signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(200))
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchWithTimeout('http://x', { method: 'POST' })
    expect(out.status).toBe(200)
    expect(fetchMock.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal)
    expect(fetchMock.mock.calls[0]![1].method).toBe('POST')
  })

  it('aborts a hung request after the timeout with a TimeoutError', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason))
    })))
    const started = Date.now()
    await expect(fetchWithTimeout('http://x', {}, { timeoutMs: 50 })).rejects.toSatisfy(isTimeoutError)
    expect(Date.now() - started).toBeLessThan(2_000)
  })

  it('retries a 503 with backoff, then returns the good response', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(503)).mockResolvedValueOnce(res(200))
    vi.stubGlobal('fetch', fetchMock)
    const out = await fetchWithTimeout('http://x', {}, { retries: 2, backoffMs: 1 })
    expect(out.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('returns the last retryable response once retries run out', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(503))
    vi.stubGlobal('fetch', fetchMock)
    expect((await fetchWithTimeout('http://x', {}, { retries: 1, backoffMs: 1 })).status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never retries without being asked, and never retries a 4xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(res(503))
    vi.stubGlobal('fetch', fetchMock)
    await fetchWithTimeout('http://x')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockClear().mockResolvedValue(res(404))
    await fetchWithTimeout('http://x', {}, { retries: 3, backoffMs: 1 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a network failure, then surfaces it', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchWithTimeout('http://x', {}, { retries: 1, backoffMs: 1 })).rejects.toThrow('ECONNRESET')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry when the caller aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetchMock = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchWithTimeout('http://x', { signal: controller.signal }, { retries: 3, backoffMs: 1 })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
