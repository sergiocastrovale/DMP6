import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBrowseStore } from '../../stores/browse'

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

const response = (overrides: Partial<{ items: unknown[], total: number, hasMore: boolean }> = {}) => ({
  items: [], total: 0, mainCount: 0, page: 1, hasMore: false, ...overrides,
})

describe('useBrowseStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(response())
  })

  it('fetchArtists assembles params: only truthy filters are included', async () => {
    const store = useBrowseStore()
    store.searchQuery = 'boards'
    store.letterFilter = 'B'
    store.minCompleteness = 40
    await store.fetchArtists()
    expect(fetchMock).toHaveBeenCalledWith('/api/artists', expect.objectContaining({
      params: { page: 1, pageSize: 48, sort: 'name', order: 'asc', search: 'boards', letter: 'B', minCompleteness: 40 },
    }))
  })

  it('setLetterFilter clears the search query and refetches', async () => {
    const store = useBrowseStore()
    store.searchQuery = 'old query'
    store.setLetterFilter('C')
    expect(store.letterFilter).toBe('C')
    expect(store.searchQuery).toBe('')
  })

  it('setSearch clears the letter filter when a query is set', () => {
    const store = useBrowseStore()
    store.letterFilter = 'B'
    store.setSearch('aphex')
    expect(store.letterFilter).toBeNull()
    expect(store.searchQuery).toBe('aphex')
  })

  it('setViewMode summarized bumps pageSize to 250, expanded resets to 48', () => {
    const store = useBrowseStore()
    store.setViewMode('summarized')
    expect(store.pageSize).toBe(250)
    store.setViewMode('expanded')
    expect(store.pageSize).toBe(48)
  })

  it('setViewMode is a no-op (no refetch) when the mode is unchanged', async () => {
    const store = useBrowseStore()
    store.setViewMode('expanded') // already expanded - should short-circuit
    await Promise.resolve()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loadMore increments the page and appends results', async () => {
    fetchMock.mockResolvedValueOnce(response({ items: [{ slug: 'a' }], hasMore: true }))
    const store = useBrowseStore()
    await store.fetchArtists()
    fetchMock.mockResolvedValueOnce(response({ items: [{ slug: 'b' }], hasMore: false }))
    await store.loadMore()
    expect(store.page).toBe(2)
    expect(store.artists.map((a: any) => a.slug)).toEqual(['a', 'b'])
  })

  it('loadMore is a no-op when hasMore is false', async () => {
    const store = useBrowseStore()
    store.hasMore = false
    await store.loadMore()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loadMore is a no-op while a fresh (non-append) fetch is in flight', async () => {
    // Regression: a filter/sort change kicks off fetchArtists(page 1). If the InfiniteScroll
    // sentinel is still intersecting mid-reload, it must not fire a concurrent append fetch that
    // aborts the correct one and appends a stale-offset page.
    const store = useBrowseStore()
    store.hasMore = true

    let resolveFresh: (v: unknown) => void
    const freshPromise = new Promise((resolve) => { resolveFresh = resolve })
    fetchMock.mockReturnValueOnce(freshPromise)

    const freshCall = store.fetchArtists()
    expect(store.loading).toBe(true)

    fetchMock.mockClear()
    await store.loadMore()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(store.page).toBe(1)

    resolveFresh!(response({ items: [{ slug: 'a' }] }))
    await freshCall
  })

  it('a non-append fetch replaces the artist list and resets page to 1', async () => {
    fetchMock.mockResolvedValueOnce(response({ items: [{ slug: 'a' }] }))
    const store = useBrowseStore()
    store.page = 5
    await store.fetchArtists()
    expect(store.page).toBe(1)
    expect(store.artists).toEqual([{ slug: 'a' }])
  })

  it('a request aborted by a newer one resolves quietly instead of throwing (regression: unhandled rejection)', async () => {
    // ofetch wraps an AbortController.abort() as its own FetchError, whose .name is 'FetchError' -
    // the actual AbortError lives at .cause. Reproduces the live "Uncaught (in promise) FetchError
    // ... Caused by: AbortError" seen from rapid genre-filter toggling.
    const abortFetchError = Object.assign(new Error('aborted'), {
      name: 'FetchError',
      cause: new DOMException('signal is aborted without reason', 'AbortError'),
    })
    fetchMock.mockRejectedValueOnce(abortFetchError)
    const store = useBrowseStore()
    await expect(store.fetchArtists()).resolves.toBeUndefined()
  })

  it('a stale response arriving after a newer request never overwrites the fresher one (audit #77)', async () => {
    const store = useBrowseStore()

    let resolveStale: (v: unknown) => void
    const stalePromise = new Promise((resolve) => { resolveStale = resolve })
    fetchMock.mockReturnValueOnce(stalePromise)

    // Fire the stale request (search='old') but don't await it - it hangs until resolveStale() below.
    store.searchQuery = 'old'
    const staleCall = store.fetchArtists()

    // A newer request supersedes it before the stale one resolves.
    fetchMock.mockResolvedValueOnce(response({ items: [{ slug: 'fresh' }] }))
    store.searchQuery = 'new'
    await store.fetchArtists()
    expect(store.artists).toEqual([{ slug: 'fresh' }])

    // Now let the stale request resolve - it must be ignored, not clobber the fresh result.
    resolveStale!(response({ items: [{ slug: 'stale' }] }))
    await staleCall
    expect(store.artists).toEqual([{ slug: 'fresh' }])
  })

  it('sends the sort direction so the server does not have to guess it', async () => {
    const store = useBrowseStore()
    await store.fetchArtists()
    expect(fetchMock).toHaveBeenCalledWith('/api/artists', expect.objectContaining({
      params: expect.objectContaining({ sort: 'name', order: 'asc' }),
    }))
  })

  it('picking a different column resets to that column\'s default direction', () => {
    const store = useBrowseStore()
    expect(store.sortDir).toBe('asc') // name
    store.setSortBy('playCount')
    expect(store.sortDir).toBe('desc')
    store.setSortBy('name')
    expect(store.sortDir).toBe('asc')
  })

  it('re-picking the column already active flips the direction', () => {
    // This is what clicking an already-sorted table header means.
    const store = useBrowseStore()
    store.setSortBy('playCount')
    expect(store.sortDir).toBe('desc')
    store.setSortBy('playCount')
    expect(store.sortDir).toBe('asc')
    store.setSortBy('playCount')
    expect(store.sortDir).toBe('desc')
  })

  it('toggleSortDir flips and refetches', async () => {
    const store = useBrowseStore()
    fetchMock.mockClear()
    store.toggleSortDir()
    expect(store.sortDir).toBe('desc')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('setSortDir does not refetch when the direction is already what was asked for', () => {
    const store = useBrowseStore()
    fetchMock.mockClear()
    store.setSortDir('asc')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
