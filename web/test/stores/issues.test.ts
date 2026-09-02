import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useIssuesStore } from '../../stores/issues'

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

const paginated = (items: unknown[] = []) => ({ items, total: items.length, page: 1, pageSize: 50, hasMore: false })

describe('useIssuesStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(paginated())
  })

  it('setSort: first call on a type sets asc order and resets to page 1', async () => {
    const store = useIssuesStore()
    store.page.corrupted = 5
    await store.setSort('corrupted' as any, 'title')
    expect(store.sort.corrupted).toBe('title')
    expect(store.order.corrupted).toBe('asc')
    expect(store.page.corrupted).toBe(1)
  })

  it('setSort: calling again with the same key toggles asc <-> desc', async () => {
    const store = useIssuesStore()
    await store.setSort('corrupted' as any, 'title')
    await store.setSort('corrupted' as any, 'title')
    expect(store.order.corrupted).toBe('desc')
    await store.setSort('corrupted' as any, 'title')
    expect(store.order.corrupted).toBe('asc')
  })

  it('setSort: a different key resets order to asc', async () => {
    const store = useIssuesStore()
    await store.setSort('corrupted' as any, 'title')
    await store.setSort('corrupted' as any, 'title') // now desc
    await store.setSort('corrupted' as any, 'artist')
    expect(store.sort.corrupted).toBe('artist')
    expect(store.order.corrupted).toBe('asc')
  })

  it('queueIds returns the queued count from the server (partial-queue is possible)', async () => {
    fetchMock.mockResolvedValue({ queued: 2 })
    const store = useIssuesStore()
    const queued = await store.queueIds('corrupted' as any, ['a', 'b', 'c'])
    expect(queued).toBe(2) // fewer than requested - some ids were not DETECTED
  })

  it('patchIssue optimistically merges the body into the local item list', async () => {
    const store = useIssuesStore()
    store.items.corrupted = [{ id: 'x', proposedValue: 'old' }]
    fetchMock.mockResolvedValue({ ok: true })
    await store.patchIssue('corrupted' as any, 'x', { proposedValue: 'new' })
    expect(store.items.corrupted[0]).toEqual({ id: 'x', proposedValue: 'new' })
  })

  it('patchIssue leaves the local list unchanged on a server error (the known stale-edit bug)', async () => {
    const store = useIssuesStore()
    store.items.corrupted = [{ id: 'x', proposedValue: 'old' }]
    fetchMock.mockRejectedValue(new Error('422 No valid fields'))
    await expect(store.patchIssue('corrupted' as any, 'x', { proposedValue: 'new' })).rejects.toThrow()
    // Documented gap: patchIssue only reconciles state in the success path - a thrown fetch means the
    // optimistic-merge code below never runs, so nothing rolls back either... but since the merge only
    // happens AFTER the await, on error the local list is simply untouched (still shows the OLD value).
    expect(store.items.corrupted[0]).toEqual({ id: 'x', proposedValue: 'old' })
  })

  it('patchIssue is a no-op on the local list when the type has no cached items yet', async () => {
    const store = useIssuesStore()
    fetchMock.mockResolvedValue({ ok: true })
    await expect(store.patchIssue('corrupted' as any, 'x', { proposedValue: 'new' })).resolves.toBeUndefined()
  })

  it('fetchType resets page/items when reset=true', async () => {
    const store = useIssuesStore()
    store.page.corrupted = 3
    store.items.corrupted = [{ id: 'stale' }]
    fetchMock.mockResolvedValue(paginated([{ id: 'fresh' }]))
    await store.fetchType('corrupted' as any, true)
    expect(store.items.corrupted).toEqual([{ id: 'fresh' }])
  })

  it('undoHistoryItems returns the per-type queued counts', async () => {
    fetchMock.mockResolvedValue({ queued: { corrupted: 1, missing: 0 } })
    const store = useIssuesStore()
    const result = await store.undoHistoryItems(['h1', 'h2'])
    expect(result).toEqual({ corrupted: 1, missing: 0 })
  })

  it('a stale fetchType response for the same type never overwrites a fresher one (audit #77)', async () => {
    const store = useIssuesStore()

    let resolveStale: (v: unknown) => void
    const stalePromise = new Promise((resolve) => { resolveStale = resolve })
    fetchMock.mockReturnValueOnce(stalePromise)

    const staleCall = store.fetchType('corrupted' as any)

    fetchMock.mockResolvedValueOnce(paginated([{ id: 'fresh' }]))
    await store.fetchType('corrupted' as any)
    expect(store.items.corrupted).toEqual([{ id: 'fresh' }])

    resolveStale!(paginated([{ id: 'stale' }]))
    await staleCall
    expect(store.items.corrupted).toEqual([{ id: 'fresh' }])
  })

  it('a stale fetchType for a DIFFERENT type is unaffected (independent abort controllers)', async () => {
    const store = useIssuesStore()
    fetchMock.mockResolvedValueOnce(paginated([{ id: 'corrupted-item' }]))
    await store.fetchType('corrupted' as any)
    fetchMock.mockResolvedValueOnce(paginated([{ id: 'orphans-item' }]))
    await store.fetchType('orphans' as any)
    expect(store.items.corrupted).toEqual([{ id: 'corrupted-item' }])
    expect(store.items.orphans).toEqual([{ id: 'orphans-item' }])
  })

  it('fetchSummary populates summary and toggles the loading flag', async () => {
    fetchMock.mockResolvedValue({ corrupted: 3 })
    const store = useIssuesStore()

    const promise = store.fetchSummary()
    expect(store.summaryLoading).toBe(true)
    await promise

    expect(store.summary).toEqual({ corrupted: 3 })
    expect(store.summaryLoading).toBe(false)
  })

  it('fetchResolved populates the resolved list, scoped from the live list', async () => {
    fetchMock.mockResolvedValue(paginated([{ id: 'r1' }]))
    const store = useIssuesStore()

    await store.fetchResolved('corrupted' as any)

    expect(store.resolvedItems.corrupted).toEqual([{ id: 'r1' }])
    expect(store.resolvedLoading.corrupted).toBe(false)
  })

  it('setPage updates the page then refetches', async () => {
    fetchMock.mockResolvedValue(paginated([{ id: 'p2' }]))
    const store = useIssuesStore()

    await store.setPage('corrupted' as any, 2)

    expect(store.page.corrupted).toBe(2)
    expect(store.items.corrupted).toEqual([{ id: 'p2' }])
  })

  it('setResolvedPage updates the resolved page then refetches', async () => {
    fetchMock.mockResolvedValue(paginated([{ id: 'rp2' }]))
    const store = useIssuesStore()

    await store.setResolvedPage('corrupted' as any, 2)

    expect(store.resolvedPage.corrupted).toBe(2)
    expect(store.resolvedItems.corrupted).toEqual([{ id: 'rp2' }])
  })

  it('setSearch resets to page 1 and refetches', async () => {
    fetchMock.mockResolvedValue(paginated([{ id: 'found' }]))
    const store = useIssuesStore()
    store.page.corrupted = 5

    await store.setSearch('corrupted' as any, 'query text')

    expect(store.search.corrupted).toBe('query text')
    expect(store.page.corrupted).toBe(1)
    expect(store.items.corrupted).toEqual([{ id: 'found' }])
  })

  it('queueRevert returns the queued count', async () => {
    fetchMock.mockResolvedValue({ queued: 4, mode: 'undo' })
    const store = useIssuesStore()

    const queued = await store.queueRevert('corrupted' as any, ['a', 'b'], 'undo')

    expect(queued).toBe(4)
  })

  it('fetchHistoryCounts populates historyCounts', async () => {
    fetchMock.mockResolvedValue({ counts: { corrupted: 2, missing: 1 }, total: 3 })
    const store = useIssuesStore()

    await store.fetchHistoryCounts()

    expect(store.historyCounts).toEqual({ corrupted: 2, missing: 1 })
  })

  it('fetchHistory resets page/items on reset=true and toggles loading', async () => {
    fetchMock.mockResolvedValue(paginated([{ id: 'h1' }]))
    const store = useIssuesStore()
    store.historyPage.corrupted = 3
    store.historyItems.corrupted = [{ id: 'stale' } as any]

    await store.fetchHistory('corrupted' as any, true)

    expect(store.historyItems.corrupted).toEqual([{ id: 'h1' }])
    expect(store.historyLoading.corrupted).toBe(false)
  })

  it('setHistoryPage updates the page then refetches history', async () => {
    fetchMock.mockResolvedValue(paginated([{ id: 'h2' }]))
    const store = useIssuesStore()

    await store.setHistoryPage('corrupted' as any, 2)

    expect(store.historyPage.corrupted).toBe(2)
    expect(store.historyItems.corrupted).toEqual([{ id: 'h2' }])
  })

  it('clearHistoryItems calls the delete endpoint with the given ids', async () => {
    fetchMock.mockResolvedValue(undefined)
    const store = useIssuesStore()

    await store.clearHistoryItems(['h1', 'h2'])

    expect(fetchMock).toHaveBeenCalledWith('/api/issues/history', { method: 'DELETE', body: { ids: ['h1', 'h2'] } })
  })
})
