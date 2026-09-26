import type { SearchArtist, SearchPage } from '~/types/search'
import type { NetworkGraph } from '~/types/labs'

// Data and search behind Labs -> Artist Network: the whole-library graph (filtered by a minimum of shared tracks) or the
// collaborations of one selected artist, and the artist search that selects one.
export const useNetworkGraph = () => {
  const loading = ref(true)
  const graphData = ref<NetworkGraph | null>(null)
  const minShared = ref(2)
  const selectedArtist = ref<{ id: string, name: string } | null>(null)

  const searchQuery = ref('')
  const searchResults = ref<{ id: string, name: string, slug: string }[]>([])
  const searchOpen = ref(false)
  // Closing on blur would swallow the click on a result, so it waits a beat.
  const blurSearch = () => setTimeout(() => { searchOpen.value = false }, 200)

  const load = async (artistId?: string) => {
    loading.value = true
    try {
      const query: Record<string, string | number> = artistId ? { artistId } : { minShared: minShared.value }
      graphData.value = await $fetch<NetworkGraph>('/api/labs/network/graph', { query })
    }
    finally {
      loading.value = false
    }
  }

  const search = async (q: string) => {
    if (q.length < 2) {
      searchResults.value = []
      return
    }
    const data = await $fetch<SearchPage<SearchArtist>>('/api/search/artists', { query: { q, pageSize: 10 } })
    searchResults.value = data.items.map(a => ({ id: a.id, name: a.name, slug: a.slug }))
  }

  watch(searchQuery, search)

  const selectArtist = async (artist: { id: string, name: string }) => {
    selectedArtist.value = artist
    searchQuery.value = artist.name
    searchOpen.value = false
    searchResults.value = []
    await load(artist.id)
  }

  const clearSearch = async () => {
    selectedArtist.value = null
    searchResults.value = []
    await load()
  }

  watch(minShared, () => {
    if (!selectedArtist.value) {
      load()
    }
  })

  onMounted(() => load())

  return {
    loading, graphData, minShared, selectedArtist,
    searchQuery, searchResults, searchOpen, blurSearch,
    selectArtist, clearSearch,
  }
}
