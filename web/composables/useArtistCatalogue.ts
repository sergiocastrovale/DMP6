import type { UnifiedRelease, ReleaseGroup } from '~/types/release'
import type { CatalogueCounts } from '~/types/artist'
import { favoriteTargetId } from '~/helpers/artistPageLogic'

const countReleases = (releases: UnifiedRelease[]): CatalogueCounts => {
  const counts: CatalogueCounts = { total: 0, albums: 0, eps: 0, singles: 0 }
  for (const r of releases) {
    if (r.typeSlug === 'album') { counts.albums++; counts.total++ }
    else if (r.typeSlug === 'ep') { counts.eps++; counts.total++ }
    else if (r.typeSlug === 'single') { counts.singles++; counts.total++ }
  }
  return counts
}

const dateKey = (r: UnifiedRelease) => r.releaseDate || (r.year ? `${r.year}-00-00` : '9999-99-99')

const buildGroups = (releases: UnifiedRelease[]): ReleaseGroup[] => {
  const buckets = new Map<string, UnifiedRelease[]>()
  for (const r of releases) {
    const key = r.releaseGroupId || `solo:${r.id}`
    const arr = buckets.get(key)
    if (arr) { arr.push(r) } else { buckets.set(key, [r]) }
  }
  const out: ReleaseGroup[] = []
  for (const [key, items] of buckets.entries()) {
    items.sort((a, b) => dateKey(a).localeCompare(dateKey(b)))
    const primary = items[0]!
    out.push({
      key,
      releases: items,
      primary,
      totalTracks: items.reduce((s, r) => s + (r.trackCount || 0), 0),
      totalLocalTracks: items.reduce((s, r) => s + (r.localTrackCount || 0), 0),
      totalPlayCount: items.reduce((s, r) => s + (r.totalPlayCount || 0), 0),
      earliest: dateKey(primary),
    })
  }
  return out
}

export const useArtistCatalogue = (releases: Ref<UnifiedRelease[]>) => {
  const hideMissing = ref(false)
  const showLinked = ref(true)
  const favoritesOnly = ref(false)
  const searchQuery = ref('')
  const typeFilters = ref<Set<string>>(new Set())
  const activeStatuses = ref<Set<string>>(new Set())
  const sortKey = ref<string>('year-asc')

  const favoriteReleases = ref<Set<string>>(new Set())
  onMounted(async () => {
    try {
      const data = await $fetch<any>('/api/favorites', { query: { type: 'releases', pageSize: 100 } })
      if (data?.releases) {
        favoriteReleases.value = new Set(data.releases.map((f: any) => f.release.id))
      }
    }
    catch { /* ignore */ }
  })

  const hasLinkedReleases = computed(() => releases.value.some(r => r.connectedArtistName))

  const visibleReleases = computed(() => {
    let r = releases.value
    if (hideMissing.value) { r = r.filter(x => x.status !== 'MISSING') }
    if (!showLinked.value) { r = r.filter(x => !x.connectedArtistName) }
    if (favoritesOnly.value) {
      r = r.filter((x) => {
        const id = favoriteTargetId(x)
        return !!id && favoriteReleases.value.has(id)
      })
    }
    return r
  })

  const statusCounts = computed(() => {
    const counts: Record<string, number> = {}
    for (const r of visibleReleases.value) {
      counts[r.status] = (counts[r.status] || 0) + 1
    }
    return counts
  })

  const filteredReleases = computed(() => {
    let r = visibleReleases.value
    if (activeStatuses.value.size > 0) {
      r = r.filter(x => activeStatuses.value.has(x.status))
    }
    if (typeFilters.value.size > 0) {
      r = r.filter(x =>
        typeFilters.value.has(x.typeSlug)
        || (typeFilters.value.has('other') && !['album', 'ep', 'single'].includes(x.typeSlug)),
      )
    }
    if (searchQuery.value) {
      const q = searchQuery.value.toLowerCase()
      r = r.filter(x =>
        x.title.toLowerCase().includes(q)
        || (x.disambiguation || '').toLowerCase().includes(q)
        || (x.editionLabel || '').toLowerCase().includes(q),
      )
    }
    return r
  })

  const groups = computed(() => buildGroups(filteredReleases.value))

  const totalCounts = computed(() => countReleases(releases.value))
  const visibleCounts = computed(() => countReleases(filteredReleases.value))

  // Sort excluded, same convention as stores/browse.ts's activeFilterCount - it always has a value.
  const activeFilterCount = computed(() =>
    typeFilters.value.size
    + activeStatuses.value.size
    + (hideMissing.value ? 1 : 0)
    + (showLinked.value ? 0 : 1)
    + (favoritesOnly.value ? 1 : 0),
  )

  const clearFilters = () => {
    typeFilters.value = new Set()
    activeStatuses.value = new Set()
    hideMissing.value = false
    showLinked.value = true
    favoritesOnly.value = false
  }

  return {
    hideMissing,
    showLinked,
    favoritesOnly,
    favoriteReleases,
    searchQuery,
    typeFilters,
    activeStatuses,
    sortKey,
    hasLinkedReleases,
    visibleReleases,
    statusCounts,
    filteredReleases,
    groups,
    totalCounts,
    visibleCounts,
    activeFilterCount,
    clearFilters,
  }
}
