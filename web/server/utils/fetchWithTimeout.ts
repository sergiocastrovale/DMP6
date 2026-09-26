// Every outbound HTTP call goes through here so a hung upstream (slskd, MusicBrainz, Last.fm, Genius) cannot hold a
// request handler or the monitor loop forever: Node's fetch has no timeout of its own.

export const DEFAULT_FETCH_TIMEOUT_MS = 10_000

export interface FetchOptions {
  timeoutMs?: number
  // Extra attempts after the first, only for a network failure, a timeout, or a 502/503/504 - and only worth passing for
  // idempotent requests.
  retries?: number
  // Wait before retry n (1-based) is backoffMs * 2^(n-1).
  backoffMs?: number
}

const RETRYABLE_STATUS = new Set([502, 503, 504])

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export const fetchWithTimeout = async (
  url: string | URL,
  init: RequestInit = {},
  { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, retries = 0, backoffMs = 500 }: FetchOptions = {},
): Promise<Response> => {
  for (let attempt = 0; ; attempt++) {
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout
    try {
      const res = await fetch(url, { ...init, signal })
      if (attempt < retries && RETRYABLE_STATUS.has(res.status)) {
        await res.body?.cancel().catch(() => {})
        await sleep(backoffMs * 2 ** attempt)
        continue
      }
      return res
    }
    catch (e) {
      // A caller-initiated abort is the caller's decision, never retried.
      if (init.signal?.aborted || attempt >= retries) {
        throw e
      }
      await sleep(backoffMs * 2 ** attempt)
    }
  }
}

export const isTimeoutError = (e: unknown): boolean => (e as { name?: string } | null)?.name === 'TimeoutError'
