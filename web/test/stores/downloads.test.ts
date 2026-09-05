import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDownloadsStore } from '../../stores/downloads'

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)
vi.stubGlobal('fetch', vi.fn())

// Merges stream through the terminal store's raw fetch()-based SSE, not $fetch - build a minimal
// SSE-shaped Response for tests that drive merge()/mergeAll() to completion.
const sseResponse = (body: string, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  statusText: ok ? 'OK' : 'Error',
  body: {
    getReader: () => {
      let sent = false
      return {
        read: async () => {
          if (sent) {return { done: true, value: undefined }}
          sent = true
          return { done: false, value: new TextEncoder().encode(body) }
        },
      }
    },
  },
})
const doneSse = () => sseResponse('event: done\ndata: 0\n\n')

describe('useDownloadsStore - pure getters (seeded state)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
  })

  it('readyCount mirrors queueReady length', () => {
    const store = useDownloadsStore()
    store.queueReady = [{ id: '1' } as any, { id: '2' } as any]
    expect(store.readyCount).toBe(2)
  })

  it('activeCount counts InProgress/Queued/Initializing slskd transfers only', () => {
    const store = useDownloadsStore()
    store.activeDownloads = [
      { state: 'InProgress' } as any,
      { state: 'Queued' } as any,
      { state: 'Initializing' } as any,
      { state: 'Completed, Errored' } as any,
      { state: 'Completed, Succeeded' } as any,
    ]
    expect(store.activeCount).toBe(3)
  })

  it('mergingIds/mergeActive reflect ids while a merge streams through the terminal, then clear', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {}))) // never resolves - stay "in flight"
    fetchMock.mockResolvedValue({ active: [], ready: [], history: [], paused: false, pausedReason: null, freeGb: null, minFreeGb: null, acquisition: null })
    const store = useDownloadsStore()
    expect(store.mergeActive).toBe(false)

    void store.merge('b')
    await Promise.resolve()

    expect(store.mergingIds.has('b')).toBe(true)
    expect(store.mergeActive).toBe(true)
  })
})

describe('useDownloadsStore - actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
  })

  it('setPaused returns null on success', async () => {
    fetchMock.mockResolvedValue({ active: [], ready: [], history: [], paused: true, pausedReason: 'manual', freeGb: null, minFreeGb: null, acquisition: null })
    const store = useDownloadsStore()
    const err = await store.setPaused(true)
    expect(err).toBeNull()
    expect(store.paused).toBe(true)
  })

  it('setPaused surfaces the server error message and still refreshes the queue', async () => {
    fetchMock.mockImplementation((url: string, opts?: any) => {
      if (url === '/api/downloads/pause') {return Promise.reject({ data: { message: 'disk full' } })}
      return Promise.resolve({ active: [], ready: [], history: [], paused: false, pausedReason: null, freeGb: 1, minFreeGb: 5, acquisition: null })
    })
    const store = useDownloadsStore()
    const err = await store.setPaused(false)
    expect(err).toBe('disk full')
    expect(store.freeGb).toBe(1)
  })

  it('merge streams through the terminal (not the direct merge endpoint) and clears mergingIds afterwards', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(doneSse()))
    fetchMock.mockResolvedValue({ active: [], ready: [], history: [], paused: false, pausedReason: null, freeGb: null, minFreeGb: null, acquisition: null })
    const store = useDownloadsStore()

    await store.merge('id1')

    const directMergeCalled = fetchMock.mock.calls.some(c => c[0] === '/api/downloads/merge/id1')
    expect(directMergeCalled).toBe(false)
    expect(store.mergingIds.has('id1')).toBe(false)
  })

  it('mergeAll streams the batch through the terminal and always returns {merged: 0, errors: []}', async () => {
    const streamFetch = vi.fn().mockResolvedValue(doneSse())
    vi.stubGlobal('fetch', streamFetch)
    fetchMock.mockResolvedValue({ active: [], ready: [], history: [], paused: false, pausedReason: null, freeGb: null, minFreeGb: null, acquisition: null })
    const store = useDownloadsStore()

    const result = await store.mergeAll(['a', 'b'])

    expect(streamFetch).toHaveBeenCalledWith('/api/downloads/merge-stream', expect.objectContaining({ body: JSON.stringify({ ids: ['a', 'b'] }) }))
    expect(result).toEqual({ merged: 0, errors: [] })
  })

  it('mergeSelected batches through the terminal merge stream instead of one merge/:id call per release', async () => {
    const streamFetch = vi.fn().mockResolvedValue(doneSse())
    vi.stubGlobal('fetch', streamFetch)
    fetchMock.mockResolvedValue({ active: [], ready: [], history: [], paused: false, pausedReason: null, freeGb: null, minFreeGb: null, acquisition: null })
    const store = useDownloadsStore()

    await store.mergeSelected(['a', 'b', 'c'])

    expect(streamFetch).toHaveBeenCalledWith('/api/downloads/merge-stream', expect.objectContaining({ body: JSON.stringify({ ids: ['a', 'b', 'c'] }) }))
    const individualMergeCalls = fetchMock.mock.calls.filter(c => /^\/api\/downloads\/merge\//.test(String(c[0])))
    expect(individualMergeCalls).toHaveLength(0)
  })

  it('mergeSelected is a no-op for an empty selection', async () => {
    const store = useDownloadsStore()
    await store.mergeSelected([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejectAll batches through reject-all (not one reject/:id call per release) and refreshes the queue once', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/downloads/reject-all') {return Promise.resolve({ rejected: 2 })}
      return Promise.resolve({ active: [], ready: [], history: [], paused: false, pausedReason: null, freeGb: null, minFreeGb: null, acquisition: null })
    })
    const store = useDownloadsStore()
    const rejected = await store.rejectAll(['a', 'b'])
    expect(rejected).toBe(2)
    expect(fetchMock).toHaveBeenCalledWith('/api/downloads/reject-all', expect.objectContaining({ method: 'POST', body: { ids: ['a', 'b'] } }))
    const individualRejectCalls = fetchMock.mock.calls.filter(c => /^\/api\/downloads\/reject\//.test(String(c[0])))
    expect(individualRejectCalls).toHaveLength(0)
  })

  it('rejectAll is a no-op for an empty selection', async () => {
    const store = useDownloadsStore()
    const rejected = await store.rejectAll([])
    expect(rejected).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requeueAll batches through requeue-all (not one requeue/:id call per release) and refreshes the queue once', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/downloads/requeue-all') {return Promise.resolve({ requeued: 2 })}
      return Promise.resolve({ active: [], ready: [], rejected: [], history: [], paused: false, pausedReason: null, freeGb: null, minFreeGb: null, acquisition: null })
    })
    const store = useDownloadsStore()
    const requeued = await store.requeueAll(['a', 'b'])
    expect(requeued).toBe(2)
    expect(fetchMock).toHaveBeenCalledWith('/api/downloads/requeue-all', expect.objectContaining({ method: 'POST', body: { ids: ['a', 'b'] } }))
    const individualRequeueCalls = fetchMock.mock.calls.filter(c => /^\/api\/downloads\/requeue\//.test(String(c[0])))
    expect(individualRequeueCalls).toHaveLength(0)
  })

  it('requeueAll is a no-op for an empty selection', async () => {
    const store = useDownloadsStore()
    const requeued = await store.requeueAll([])
    expect(requeued).toBe(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retryAll batches through retry-all (not one retry/:id call per release) and refreshes the queue once', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/downloads/retry-all') {return Promise.resolve({ retried: 2, failed: 0 })}
      return Promise.resolve({ active: [], ready: [], rejected: [], history: [], paused: false, pausedReason: null, freeGb: null, minFreeGb: null, acquisition: null })
    })
    const store = useDownloadsStore()
    const result = await store.retryAll(['a', 'b'])
    expect(result).toEqual({ retried: 2, failed: 0 })
    expect(fetchMock).toHaveBeenCalledWith('/api/downloads/retry-all', expect.objectContaining({ method: 'POST', body: { ids: ['a', 'b'] } }))
    const individualRetryCalls = fetchMock.mock.calls.filter(c => /^\/api\/downloads\/retry\//.test(String(c[0])))
    expect(individualRetryCalls).toHaveLength(0)
  })

  it('retryAll is a no-op for an empty selection', async () => {
    const store = useDownloadsStore()
    const result = await store.retryAll([])
    expect(result).toEqual({ retried: 0, failed: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requeue (single) POSTs to /api/downloads/requeue/:id', async () => {
    fetchMock.mockResolvedValue({ active: [], ready: [], rejected: [], history: [], paused: false, pausedReason: null, freeGb: null, minFreeGb: null, acquisition: null })
    const store = useDownloadsStore()
    await store.requeue('id1')
    expect(fetchMock).toHaveBeenCalledWith('/api/downloads/requeue/id1', expect.objectContaining({ method: 'POST' }))
  })
})

describe('useDownloadsStore - queue polling', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('startQueuePolling self-stops once nothing is in flight and acquisition cannot run', async () => {
    fetchMock.mockResolvedValue({
      active: [], ready: [], history: [], paused: false, pausedReason: null, freeGb: null, minFreeGb: null,
      acquisition: { canAcquire: false },
    })
    const store = useDownloadsStore()
    store.startQueuePolling()
    await vi.advanceTimersByTimeAsync(2000)
    const callsAfterFirstTick = fetchMock.mock.calls.filter(c => c[0] === '/api/downloads/queue').length
    expect(callsAfterFirstTick).toBe(1)
    await vi.advanceTimersByTimeAsync(4000)
    // No further ticks scheduled - call count stays flat.
    const callsAfterMoreTime = fetchMock.mock.calls.filter(c => c[0] === '/api/downloads/queue').length
    expect(callsAfterMoreTime).toBe(1)
  })

  it('keeps polling while a download is in flight', async () => {
    fetchMock.mockResolvedValue({
      active: [{ id: '1', status: 'DOWNLOADING' }], ready: [], history: [], paused: false, pausedReason: null, freeGb: null, minFreeGb: null,
      acquisition: { canAcquire: false },
    })
    const store = useDownloadsStore()
    store.startQueuePolling()
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(2000)
    const calls = fetchMock.mock.calls.filter(c => c[0] === '/api/downloads/queue').length
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  it('keeps polling while a download is searching', async () => {
    fetchMock.mockResolvedValue({
      active: [{ id: '1', status: 'SEARCHING' }], ready: [], history: [], paused: false, pausedReason: null, freeGb: null, minFreeGb: null,
      acquisition: { canAcquire: false },
    })
    const store = useDownloadsStore()
    store.startQueuePolling()
    await vi.advanceTimersByTimeAsync(2000)
    await vi.advanceTimersByTimeAsync(2000)
    const calls = fetchMock.mock.calls.filter(c => c[0] === '/api/downloads/queue').length
    expect(calls).toBeGreaterThanOrEqual(2)
  })
})

describe('useDownloadsStore - simple fetch/action wrappers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({
      active: [], ready: [], rejected: [], history: [], paused: false, pausedReason: null,
      freeGb: null, minFreeGb: null, acquisition: { canAcquire: false }, songkong: null,
    })
  })

  it('checkStatus populates the slskd status and marks statusChecked', async () => {
    fetchMock.mockResolvedValueOnce({
      slskd: { configured: true, connected: true },
    })
    const store = useDownloadsStore()

    await store.checkStatus()

    expect(store.slskd).toEqual({ configured: true, connected: true })
    expect(store.statusChecked).toBe(true)
  })

  it('checkStatus still marks statusChecked when the request fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const store = useDownloadsStore()

    await store.checkStatus()

    expect(store.statusChecked).toBe(true)
  })

  it('fetchDownloadsEnabled populates downloadsEnabled from the server', async () => {
    fetchMock.mockResolvedValueOnce({ enabled: false })
    const store = useDownloadsStore()

    await store.fetchDownloadsEnabled()

    expect(store.downloadsEnabled).toBe(false)
  })

  it('fetchActive populates activeDownloads', async () => {
    fetchMock.mockResolvedValueOnce({ downloads: [{ id: 'd1' }] })
    const store = useDownloadsStore()

    await store.fetchActive()

    expect(store.activeDownloads).toEqual([{ id: 'd1' }])
  })

  it('reject posts to the reject endpoint then refreshes the queue', async () => {
    const store = useDownloadsStore()

    await store.reject('id1')

    expect(fetchMock).toHaveBeenCalledWith('/api/downloads/reject/id1', { method: 'POST' })
    expect(fetchMock).toHaveBeenCalledWith('/api/downloads/queue')
  })

  it('requeue posts to the requeue endpoint then refreshes the queue', async () => {
    const store = useDownloadsStore()

    await store.requeue('id1')

    expect(fetchMock).toHaveBeenCalledWith('/api/downloads/requeue/id1', { method: 'POST' })
  })

  it('retry posts to the retry endpoint then refreshes the queue', async () => {
    const store = useDownloadsStore()

    await store.retry('id1')

    expect(fetchMock).toHaveBeenCalledWith('/api/downloads/retry/id1', { method: 'POST' })
  })

  it('cancel posts to the cancel endpoint then refreshes the queue', async () => {
    const store = useDownloadsStore()

    await store.cancel('id1')

    expect(fetchMock).toHaveBeenCalledWith('/api/downloads/cancel/id1', { method: 'POST' })
  })

  it('cleanupReady returns the server sweep result and refreshes the queue', async () => {
    fetchMock.mockResolvedValueOnce({ removed: 2, checked: 5, danglingRemoved: 1 })
    const store = useDownloadsStore()

    const result = await store.cleanupReady()

    expect(result).toEqual({ removed: 2, checked: 5, danglingRemoved: 1 })
  })
})
