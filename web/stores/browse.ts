import { defineStore } from 'pinia'
import type { ArtistListItem } from '~/types/artist'
import { defaultSortDirection } from '~/helpers/browseSort'
import { isAbortError } from '~/helpers/functions'
import type { SortDirection } from '~/types/common'

export const useBrowseStore = defineStore('browse', () => {  
  const artists = ref<ArtistListItem[]>([])
  const total = ref(0)
  const mainCount = ref(0)
  const page = ref(1)
  const pageSize = ref(48)
  const hasMore = ref(false)
  const loading = ref(false)
  const loadingMore = ref(false)

  // Filters
  const searchQuery = ref('')
  const letterFilter = ref<string | null>(null)
  // OR semantics - an artist matches if tagged with any checked genre.
  const genreFilters = ref<string[]>([])
  const sortBy = ref('name')
  const sortDir = ref<SortDirection>(defaultSortDirection('name'))
  const minCompleteness = ref<number | null>(null)
  const maxCompleteness = ref<number | null>(null)
  const viewMode = ref<'expanded' | 'summarized'>('expanded')

  // Aborts any in-flight fetchArtists request when a newer one starts, so a slow stale response
  // (from a filter that's since changed) can never land after - and overwrite - a fresher one.
  let abortController: AbortController | null = null

  async function fetchArtists(append = false) {
    abortController?.abort()
    const controller = new AbortController()
    abortController = controller

    if (append) {
      loadingMore.value = true
    }
    else {
      loading.value = true
    }

    try {
      const params: Record<string, string | number | string[]> = {
        page: append ? page.value : 1,
        pageSize: pageSize.value,
        sort: sortBy.value,
        order: sortDir.value,
      }

      if (searchQuery.value) {params.search = searchQuery.value}
      if (letterFilter.value) {params.letter = letterFilter.value}
      if (genreFilters.value.length) {params.genre = genreFilters.value}
      if (minCompleteness.value !== null) {params.minCompleteness = minCompleteness.value}
      if (maxCompleteness.value !== null) {params.maxCompleteness = maxCompleteness.value}

      const data = await $fetch<{
        items: ArtistListItem[]
        total: number
        mainCount: number
        page: number
        hasMore: boolean
      }>('/api/artists', { params, signal: controller.signal })

      if (controller.signal.aborted) {return} // superseded by a newer request - ignore this response

      if (append) {
        artists.value.push(...data.items)
      }
      else {
        artists.value = data.items
        page.value = 1
      }
      total.value = data.total
      mainCount.value = data.mainCount
      hasMore.value = data.hasMore
    }
    catch (e) {
      if (!isAbortError(e)) {throw e}
    }
    finally {
      if (abortController === controller) {
        loading.value = false
        loadingMore.value = false
      }
    }
  }

  async function loadMore() {
    // Guard on `loading` too, not just `loadingMore`: a filter/sort change kicks off a fresh
    // page-1 fetch, and if the sentinel is still intersecting mid-reload (list momentarily short
    // or empty), the IntersectionObserver fires `@load` concurrently. Without this guard that
    // races an append fetch against the fresh one - the append aborts the correct filtered
    // request and pushes a stale-offset page onto the still-unfiltered list, so the filter/sort
    // change appears to do nothing until picked again.
    if (!hasMore.value || loadingMore.value || loading.value) {return}
    page.value++
    await fetchArtists(true)
  }

  function setLetterFilter(letter: string | null) {
    letterFilter.value = letter
    searchQuery.value = ''
    fetchArtists()
  }

  function toggleGenre(genre: string) {
    const index = genreFilters.value.indexOf(genre)
    if (index === -1) {
      genreFilters.value.push(genre)
    }
    else {
      genreFilters.value.splice(index, 1)
    }
    fetchArtists()
  }

  // Choosing a different column resets to that column's own default direction; re-choosing the
  // one already active flips it, which is what clicking its table header means.
  function setSortBy(sort: string) {
    sortDir.value = sortBy.value === sort
      ? (sortDir.value === 'asc' ? 'desc' : 'asc')
      : defaultSortDirection(sort)
    sortBy.value = sort
    fetchArtists()
  }

  function setSortDir(dir: SortDirection) {
    if (sortDir.value === dir) {
      return
    }
    sortDir.value = dir
    fetchArtists()
  }

  function toggleSortDir() {
    setSortDir(sortDir.value === 'asc' ? 'desc' : 'asc')
  }

  function setSearch(query: string) {
    searchQuery.value = query
    if (query) {letterFilter.value = null}
    fetchArtists()
  }

  function setCompletenessRange(min: number | null, max: number | null) {
    minCompleteness.value = min
    maxCompleteness.value = max
    fetchArtists()
  }

  function setViewMode(mode: 'expanded' | 'summarized') {
    if (viewMode.value === mode) {
      return
    }
    viewMode.value = mode
    pageSize.value = mode === 'summarized' ? 250 : 48
    fetchArtists()
  }

  function setPageSize(size: number) {
    if (pageSize.value === size) {
      return
    }
    pageSize.value = size
    fetchArtists()
  }

  // Genres + completeness band, cleared together in one refetch - Sort isn't a "filter" in this
  // count (it always has a value), so a fresh page with nothing ticked reads as 0.
  function clearFilters() {
    genreFilters.value = []
    minCompleteness.value = null
    maxCompleteness.value = null
    fetchArtists()
  }

  const activeFilterCount = computed(() =>
    genreFilters.value.length + (minCompleteness.value !== null || maxCompleteness.value !== null ? 1 : 0),
  )

  return {
    artists,
    total,
    mainCount,
    page,
    pageSize,
    hasMore,
    loading,
    loadingMore,
    searchQuery,
    letterFilter,
    genreFilters,
    sortBy,
    sortDir,
    minCompleteness,
    maxCompleteness,
    viewMode,
    activeFilterCount,
    fetchArtists,
    loadMore,
    setLetterFilter,
    toggleGenre,
    setSortBy,
    setSortDir,
    toggleSortDir,
    setSearch,
    setViewMode,
    setPageSize,
    setCompletenessRange,
    clearFilters,
  }
})
