import { defineStore } from 'pinia'
import type { ArtistListItem } from '~/types/artist'
import { defaultSortDirection, type SortDirection } from '~/helpers/browseSort'

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
  const genreFilter = ref<string | null>(null)
  const sortBy = ref('name')
  const sortDir = ref<SortDirection>(defaultSortDirection('name'))
  const minScore = ref<number | null>(null)
  const maxScore = ref<number | null>(null)
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
      const params: Record<string, string | number> = {
        page: append ? page.value : 1,
        pageSize: pageSize.value,
        sort: sortBy.value,
        order: sortDir.value,
      }

      if (searchQuery.value) {params.search = searchQuery.value}
      if (letterFilter.value) {params.letter = letterFilter.value}
      if (genreFilter.value) {params.genre = genreFilter.value}
      if (minScore.value !== null) {params.minScore = minScore.value}
      if (maxScore.value !== null) {params.maxScore = maxScore.value}

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
    catch (e: any) {
      if (e?.name !== 'AbortError') {throw e}
    }
    finally {
      if (abortController === controller) {
        loading.value = false
        loadingMore.value = false
      }
    }
  }

  async function loadMore() {
    if (!hasMore.value || loadingMore.value) {return}
    page.value++
    await fetchArtists(true)
  }

  function setLetterFilter(letter: string | null) {
    letterFilter.value = letter
    searchQuery.value = ''
    fetchArtists()
  }

  function setGenreFilter(genre: string | null) {
    genreFilter.value = genre
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

  function setScoreRange(min: number | null, max: number | null) {
    minScore.value = min
    maxScore.value = max
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

  function setMinScore(min: number | null) {
    minScore.value = min
    fetchArtists()
  }

  function setMaxScore(max: number | null) {
    maxScore.value = max
    fetchArtists()
  }

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
    genreFilter,
    sortBy,
    sortDir,
    minScore,
    maxScore,
    viewMode,
    fetchArtists,
    loadMore,
    setLetterFilter,
    setGenreFilter,
    setSortBy,
    setSortDir,
    toggleSortDir,
    setSearch,
    setViewMode,
    setPageSize,
    setScoreRange,
    setMinScore,
    setMaxScore,
  }
})
