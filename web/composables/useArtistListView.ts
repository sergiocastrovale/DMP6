import type { UnifiedRelease, ReleaseStatus } from '~/types/release'
import type { Track } from '~/types/track'
import { viewQueryMatches } from '~/helpers/artistPageLogic'

// The artist page's "list" view: every track of the artist in one table, filtered by the catalogue's status and search
// filters, and the ?view query that remembers the choice.
export const useArtistListView = (
  slug: () => string,
  releases: () => UnifiedRelease[],
  filters: { searchQuery: Ref<string>, activeStatuses: Ref<Set<string>> },
) => {
  const route = useRoute()
  const router = useRouter()
  const api = useApi()

  const viewMode = ref<'catalogue' | 'list'>(route.query.view === 'list' ? 'list' : 'catalogue')
  const allTracks = ref<Track[]>([])
  const allTracksLoading = ref(false)
  const allTracksLoaded = ref(false)
  let allTracksSlug = ''

  const loadAllTracks = async () => {
    if (allTracksLoaded.value && allTracksSlug === slug()) {
      return
    }
    allTracksLoading.value = true
    try {
      allTracks.value = await $fetch<Track[]>(`/api/artists/${slug()}/tracks`)
      allTracksSlug = slug()
      allTracksLoaded.value = true
    }
    catch (e) {
      api.report(e, 'Could not load the tracks')
    }
    finally {
      allTracksLoading.value = false
    }
  }

  // Only navigates when ?view actually changes. This watcher is immediate, and the artist page remounts this component
  // whenever its releases refetch (every terminal run ends with one) - an unconditional replace to the current route
  // then superseded whatever navigation was already in flight, e.g. DeleteDialog's redirect to /browse, stranding the
  // user on the deleted artist's page.
  watch(viewMode, (val) => {
    if (val === 'list') {
      loadAllTracks()
    }
    if (viewQueryMatches(route.query.view, val)) {
      return
    }
    const query = { ...route.query }
    if (val === 'list') {
      query.view = 'list'
    }
    else {
      delete query.view
    }
    router.replace({ query })
  }, { immediate: true })

  const releaseMap = computed(() => {
    const map: Record<string, { title: string, status: ReleaseStatus, image: string | null, imageUrl: string | null }> = {}
    for (const r of releases()) {
      if (r.localReleaseId) {
        map[r.localReleaseId] = { title: r.title, status: r.status, image: r.image, imageUrl: r.imageUrl }
      }
    }
    return map
  })

  const filteredAllTracks = computed(() => {
    let tracks = allTracks.value
    if (filters.activeStatuses.value.size > 0) {
      const matchingReleaseIds = new Set(
        releases()
          .filter(r => filters.activeStatuses.value.has(r.status) && r.localReleaseId)
          .map(r => r.localReleaseId),
      )
      tracks = tracks.filter(t => t.localReleaseId && matchingReleaseIds.has(t.localReleaseId))
    }
    if (filters.searchQuery.value) {
      const q = filters.searchQuery.value.toLowerCase()
      tracks = tracks.filter(t =>
        t.title?.toLowerCase().includes(q)
        || t.artist?.toLowerCase().includes(q)
        || t.album?.toLowerCase().includes(q),
      )
    }
    return tracks
  })

  return { viewMode, allTracksLoading, releaseMap, filteredAllTracks }
}
