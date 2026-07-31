import type { FavoritesResponse, FavoriteRelease, FavoriteTrack } from '~/types/favorites'

const PAGE_SIZE = 50

// Data fetching + pagination for the favorites page (releases/tracks tabs, page-restore from the
// query string, unfavorite actions). Extracted out of pages/favorites.vue to keep the page itself
// down to layout/composition.
export const useFavoritesPage = () => {
  const route = useRoute()
  const router = useRouter()

  const loading = ref(true)
  const loadingMore = ref(false)
  const releases = ref<FavoriteRelease[]>([])
  const tracks = ref<FavoriteTrack[]>([])
  const totalReleases = ref(0)
  const totalTracks = ref(0)
  const hasMoreReleases = ref(false)
  const hasMoreTracks = ref(false)
  const releasePage = ref(1)
  const trackPage = ref(1)
  const activeTab = ref<'releases' | 'tracks'>((route.query.tab as 'releases' | 'tracks') || 'releases')

  const fetchReleases = async (page: number) => {
    const data = await $fetch<FavoritesResponse>('/api/favorites', {
      query: { type: 'releases', page, pageSize: PAGE_SIZE },
    })
    releases.value.push(...data.releases)
    totalReleases.value = data.totalReleases
    hasMoreReleases.value = data.hasMoreReleases
    releasePage.value = page
  }

  const fetchTracks = async (page: number) => {
    const data = await $fetch<FavoritesResponse>('/api/favorites', {
      query: { type: 'tracks', page, pageSize: PAGE_SIZE },
    })
    tracks.value.push(...data.tracks)
    totalTracks.value = data.totalTracks
    hasMoreTracks.value = data.hasMoreTracks
    trackPage.value = page
  }

  onMounted(async () => {
    const targetPage = Math.max(1, Number(route.query.page) || 1)
    try {
      const initial = await $fetch<FavoritesResponse>('/api/favorites', {
        query: { type: 'all', page: 1, pageSize: PAGE_SIZE },
      })
      releases.value = initial.releases
      tracks.value = initial.tracks
      totalReleases.value = initial.totalReleases
      totalTracks.value = initial.totalTracks
      hasMoreReleases.value = initial.hasMoreReleases
      hasMoreTracks.value = initial.hasMoreTracks

      for (let p = 2; p <= targetPage; p++) {
        if (activeTab.value === 'releases' && hasMoreReleases.value) {
          await fetchReleases(p)
        }
        else if (activeTab.value === 'tracks' && hasMoreTracks.value) {
          await fetchTracks(p)
        }
      }
    }
    catch { /* ignore */ }
    finally {
      loading.value = false
    }
  })

  const loadMore = async () => {
    if (loadingMore.value) { return }
    const hasMore = activeTab.value === 'releases' ? hasMoreReleases.value : hasMoreTracks.value
    if (!hasMore) { return }

    loadingMore.value = true
    try {
      const next = activeTab.value === 'releases' ? releasePage.value + 1 : trackPage.value + 1
      activeTab.value === 'releases' ? await fetchReleases(next) : await fetchTracks(next)
      router.replace({ query: { ...route.query, page: String(next) } })
    }
    catch { /* ignore */ }
    finally {
      loadingMore.value = false
    }
  }

  watch(activeTab, (tab) => {
    router.replace({ query: { ...route.query, tab, page: undefined } })
  })

  const favTabs = computed(() => [
    { key: 'releases', label: 'Releases', count: totalReleases.value },
    { key: 'tracks', label: 'Tracks', count: totalTracks.value },
  ])

  const unfavoriteRelease = async (releaseId: string) => {
    try {
      await $fetch(`/api/favorites/releases/${releaseId}`, { method: 'DELETE' })
      releases.value = releases.value.filter(r => r.release.id !== releaseId)
      totalReleases.value--
    }
    catch { /* ignore */ }
  }

  const unfavoriteTrack = async (trackId: string) => {
    try {
      await $fetch(`/api/favorites/tracks/${trackId}`, { method: 'DELETE' })
      tracks.value = tracks.value.filter(t => t.track.id !== trackId)
      totalTracks.value--
    }
    catch { /* ignore */ }
  }

  return {
    loading,
    loadingMore,
    releases,
    tracks,
    activeTab,
    favTabs,
    loadMore,
    unfavoriteRelease,
    unfavoriteTrack,
  }
}
