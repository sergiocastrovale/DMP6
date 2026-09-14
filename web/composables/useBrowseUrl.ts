import type { BrowseFilterParam } from '~/types/common'
import { useBrowseStore } from '~/stores/browse'

const params: BrowseFilterParam[] = [
  { key: 'search', storeKey: 'searchQuery' },
  { key: 'letter', storeKey: 'letterFilter' },
  { key: 'genre', storeKey: 'genreFilters', type: 'list' },
  { key: 'sort', storeKey: 'sortBy', default: 'name' },
  { key: 'order', storeKey: 'sortDir', default: 'asc' },
  { key: 'mode', storeKey: 'viewMode', default: 'expanded' },
  { key: 'minCompleteness', storeKey: 'minCompleteness', type: 'number' },
  { key: 'maxCompleteness', storeKey: 'maxCompleteness', type: 'number' },
]

export const useBrowseUrl = () => {
  const route = useRoute()
  const router = useRouter()
  const store = useBrowseStore()

  const filterQuery = computed(() => {
    const q: Record<string, string | string[]> = {}
    for (const p of params) {
      const val = store[p.storeKey] as string | number | string[] | null
      if (p.type === 'list') {
        if (Array.isArray(val) && val.length) {
          q[p.key] = val
        }
        continue
      }
      if (val !== null && val !== '' && val !== p.default) {
        q[p.key] = String(val)
      }
    }
    return q
  })

  watch(filterQuery, (q) => {
    router.replace({ query: q })
  })

  const initFromUrl = () => {
    const q = route.query
    let hasParams = false

    for (const p of params) {
      const raw = q[p.key] as string | string[] | undefined
      if (!raw) {
        continue
      }
      if (p.type === 'list') {
        ;(store as any)[p.storeKey] = Array.isArray(raw) ? raw : [raw]
      }
      else {
        ;(store as any)[p.storeKey] = p.type === 'number' ? Number(raw) : raw
      }
      hasParams = true
    }

    if (store.viewMode === 'summarized') {
      ;(store as any).pageSize = 250
    }

    return hasParams
  }

  return { initFromUrl }
}
