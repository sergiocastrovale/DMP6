import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useBrowseStore } from '../../stores/browse'

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

const response = (overrides: Partial<{ items: unknown[], total: number, hasMore: boolean }> = {}) => ({
  items: [], total: 0, mainCount: 0, relatedCount: 0, page: 1, hasMore: false, ...overrides,
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
    store.minScore = 40
    await store.fetchArtists()
    expect(fetchMock).toHaveBeenCalledWith('/api/artists', {
      params: { page: 1, pageSize: 48, sort: 'name', search: 'boards', letter: 'B', minScore: 40 },
    })
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

  it('a non-append fetch replaces the artist list and resets page to 1', async () => {
    fetchMock.mockResolvedValueOnce(response({ items: [{ slug: 'a' }] }))
    const store = useBrowseStore()
    store.page = 5
    await store.fetchArtists()
    expect(store.page).toBe(1)
    expect(store.artists).toEqual([{ slug: 'a' }])
  })
})
