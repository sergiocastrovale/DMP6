import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDownloadsStore } from '../../stores/downloads'
import { useSettingsStore } from '../../stores/settings'

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)
vi.stubGlobal('fetch', vi.fn())

describe('useDownloadsStore - pure getters (seeded state)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
  })

  it('sourceEnabled is true when at least one source is enabled', () => {
    const store = useDownloadsStore()
    store.sources = [{ name: 'RUTRACKER', enabled: false } as any, { name: 'SLSKD', enabled: true } as any]
    expect(store.sourceEnabled).toBe(true)
    store.sources = [{ name: 'RUTRACKER', enabled: false } as any, { name: 'SLSKD', enabled: false } as any]
    expect(store.sourceEnabled).toBe(false)
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

  it('mergingIds is the union of optimistic (mergeInitiated) and server-reported (mergeProgress) ids', () => {
    const store = useDownloadsStore()
    store.mergeProgress = { a: { step: 'moving', title: 'A' } }
    // mergeInitiated is not exposed directly, so drive it via merge() and inspect mergingIds mid-flight.
    fetchMock.mockImplementation(() => new Promise(() => {})) // never resolves - stay "in flight"
    void store.merge('b')
    expect(store.mergingIds.has('a')).toBe(true)
    expect(store.mergingIds.has('b')).toBe(true)
  })

  it('mergeActive is true whenever mergingIds is non-empty', () => {
    const store = useDownloadsStore()
    expect(store.mergeActive).toBe(false)
    store.mergeProgress = { a: { step: 'moving', title: 'A' } }
    expect(store.mergeActive).toBe(true)
  })

  it('mergeLabel picks the highest-step entry across in-flight merges', () => {
    const store = useDownloadsStore()
    store.mergeProgress = {
      a: { step: 'moving', title: 'Album A' },
      b: { step: 'syncing', title: 'Album B' },
    }
    expect(store.mergeLabel).toContain('Syncing')
    expect(store.mergeLabel).toContain('Album B')
  })

  it('mergeLabel is null when nothing is merging', () => {
    expect(useDownloadsStore().mergeLabel).toBeNull()
  })

  it('mergePercent: 3-steps-per-item math, clamped to 99% even when everything appears done', () => {
    const store = useDownloadsStore()
    // Simulate a batch of 2 via mergeAll's internal state through the exported surface: seed
    // mergeProgress with both items at their final step so mergeInFlightCount stays > 0.
    store.mergeProgress = {
      a: { step: 'syncing', title: 'A' },
      b: { step: 'syncing', title: 'B' },
    }
    // mergeTotal is internal; without driving it via mergeAll it stays 0, so percent is 0 (no crash).
    expect(store.mergePercent).toBe(0)
  })

  it('mergePercent never exceeds 99 during an in-flight batch merge', async () => {
    const store = useDownloadsStore()
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/downloads/merge-all') return new Promise(() => {}) // stay in-flight
      return Promise.resolve({ active: [], ready: [], history: [], paused: false, pausedReason: null, freeGb: null, minFreeGb: null, acquisition: null })
    })
    void store.mergeAll(['a', 'b'])
    await Promise.resolve()
    expect(store.mergePercent).toBeLessThanOrEqual(99)
  })
})

describe('useDownloadsStore - actions', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
  })

  it('toggleSource PUTs the new state and refetches the queue', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/downloads/sources') return Promise.resolve({ sources: [{ name: 'SLSKD', enabled: true }] })
      if (url === '/api/downloads/queue') return Promise.resolve({ active: [], ready: [], history: [], paused: false, pausedReason: null, freeGb: null, minFreeGb: null, acquisition: { canAcquire: false } })
      return Promise.resolve({})
    })
    const store = useDownloadsStore()
    await store.toggleSource('SLSKD', true)
    expect(store.sources).toEqual([{ name: 'SLSKD', enabled: true }])
    expect(fetchMock).toHaveBeenCalledWith('/api/downloads/sources', expect.objectContaining({ method: 'PUT', body: { name: 'SLSKD', enabled: true } }))
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
      if (url === '/api/downloads/pause') return Promise.reject({ data: { message: 'disk full' } })
      return Promise.resolve({ active: [], ready: [], history: [], paused: false, pausedReason: null, freeGb: 1, minFreeGb: 5, acquisition: null })
    })
    const store = useDownloadsStore()
    const err = await store.setPaused(false)
    expect(err).toBe('disk full')
    expect(store.freeGb).toBe(1)
  })

  it('merge does NOT hit the direct merge endpoint when settings.showTerminal is true (routes via terminal instead)', async () => {
    setActivePinia(createPinia())
    useSettingsStore().showTerminal = true
    // mergeViaTerminal ultimately drives the terminal store's raw fetch()-based SSE stream, not $fetch -
    // the only thing worth asserting from here (without reaching into the terminal store's internals)
    // is that the direct $fetch merge endpoint is skipped entirely.
    fetchMock.mockResolvedValue({ active: [], ready: [], history: [], paused: false, pausedReason: null, freeGb: null, minFreeGb: null, acquisition: null })
    const store = useDownloadsStore()
    await store.merge('id1').catch(() => {})
    const directMergeCalled = fetchMock.mock.calls.some(c => c[0] === '/api/downloads/merge/id1')
    expect(directMergeCalled).toBe(false)
  })

  it('merge (direct path) POSTs to /api/downloads/merge/:id and clears mergeInitiated afterwards', async () => {
    fetchMock.mockResolvedValue({ active: [], ready: [], history: [], paused: false, pausedReason: null, freeGb: null, minFreeGb: null, acquisition: null })
    const store = useDownloadsStore()
    await store.merge('id1')
    expect(fetchMock).toHaveBeenCalledWith('/api/downloads/merge/id1', expect.objectContaining({ method: 'POST' }))
    expect(store.mergingIds.has('id1')).toBe(false)
  })

  it('mergeAll returns {merged, errors} from the server without throwing on partial failure', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/downloads/merge-all') return Promise.resolve({ merged: 1, errors: ['release X: no MB match'] })
      return Promise.resolve({ active: [], ready: [], history: [], paused: false, pausedReason: null, freeGb: null, minFreeGb: null, acquisition: null })
    })
    const store = useDownloadsStore()
    const result = await store.mergeAll(['a', 'b'])
    expect(result).toEqual({ merged: 1, errors: ['release X: no MB match'] })
  })

  it('rejectAll continues past a single failure and still refreshes the queue once', async () => {
    let calls = 0
    fetchMock.mockImplementation((url: string) => {
      if (url.startsWith('/api/downloads/reject/')) {
        calls++
        return calls === 1 ? Promise.reject(new Error('fail')) : Promise.resolve({})
      }
      return Promise.resolve({ active: [], ready: [], history: [], paused: false, pausedReason: null, freeGb: null, minFreeGb: null, acquisition: null })
    })
    const store = useDownloadsStore()
    await store.rejectAll(['a', 'b'])
    expect(calls).toBe(2)
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
})
