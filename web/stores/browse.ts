import { defineStore } from 'pinia'
import type { ArtistListItem } from '~/types/artist'

export const useBrowseStore = defineStore('browse', () => {  
  const artists = ref<ArtistListItem[]>([])
  const total = ref(0)
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
  const minScore = ref<number | null>(null)
  const maxScore = ref<number | null>(null)

  async function fetchArtists(append = false) {
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
      }

      if (searchQuery.value) params.search = searchQuery.value
      if (letterFilter.value) params.letter = letterFilter.value
      if (genreFilter.value) params.genre = genreFilter.value
      if (minScore.value !== null) params.minScore = minScore.value
      if (maxScore.value !== null) params.maxScore = maxScore.value

      const data = await $fetch<{
        items: ArtistListItem[]
        total: number
        page: number
        hasMore: boolean
      }>('/api/artists', { params })

      if (append) {
        artists.value.push(...data.items)
      }
      else {
        artists.value = data.items
        page.value = 1
      }
      total.value = data.total
      hasMore.value = data.hasMore
    }
    finally {
      loading.value = false
      loadingMore.value = false
    }
  }

  async function loadMore() {
    if (!hasMore.value || loadingMore.value) return
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

  function setSortBy(sort: string) {
    sortBy.value = sort
    fetchArtists()
  }

  function setSearch(query: string) {
    searchQuery.value = query
    if (query) letterFilter.value = null
    fetchArtists()
  }

  function setScoreRange(min: number | null, max: number | null) {
    minScore.value = min
    maxScore.value = max
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
    page,
    hasMore,
    loading,
    loadingMore,
    searchQuery,
    letterFilter,
    genreFilter,
    sortBy,
    minScore,
    maxScore,
    fetchArtists,
    loadMore,
    setLetterFilter,
    setGenreFilter,
    setSortBy,
    setSearch,
    setScoreRange,
    setMinScore,
    setMaxScore,
  }
})
