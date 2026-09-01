import type { UnifiedRelease, ReleaseGroup } from '~/types/release'
import type { CatalogueCounts } from '~/types/artist'
import { statuses } from '~/helpers/constants'

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
  const showMissing = ref(true)
  const showLinked = ref(true)
  const searchQuery = ref('')
  const typeFilter = ref<string | null>(null)
  const activeStatuses = ref<Set<string>>(new Set(statuses.map(s => s.value)))
  const sortKey = ref<string>('year-asc')

  const hasLinkedReleases = computed(() => releases.value.some(r => r.connectedArtistName))

  const visibleReleases = computed(() => {
    let r = releases.value
    if (!showMissing.value) { r = r.filter(x => x.status !== 'MISSING') }
    if (!showLinked.value) { r = r.filter(x => !x.connectedArtistName) }
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
    if (activeStatuses.value.size < statuses.length) {
      r = r.filter(x => activeStatuses.value.has(x.status))
    }
    if (typeFilter.value) {
      r = typeFilter.value === 'other'
        ? r.filter(x => !['album', 'ep', 'single'].includes(x.typeSlug))
        : r.filter(x => x.typeSlug === typeFilter.value)
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

  return {
    showMissing,
    showLinked,
    searchQuery,
    typeFilter,
    activeStatuses,
    sortKey,
    hasLinkedReleases,
    visibleReleases,
    statusCounts,
    filteredReleases,
    groups,
    totalCounts,
    visibleCounts,
  }
}
