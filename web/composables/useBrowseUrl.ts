import type { BrowseFilterParam } from '~/types/common'
import { useBrowseStore } from '~/stores/browse'

const params: BrowseFilterParam[] = [
  { key: 'search', storeKey: 'searchQuery' },
  { key: 'letter', storeKey: 'letterFilter' },
  { key: 'genre', storeKey: 'genreFilter' },
  { key: 'sort', storeKey: 'sortBy', default: 'name' },
  { key: 'mode', storeKey: 'viewMode', default: 'expanded' },
  { key: 'minScore', storeKey: 'minScore', type: 'number' },
  { key: 'maxScore', storeKey: 'maxScore', type: 'number' },
]

export const useBrowseUrl = () => {
  const route = useRoute()
  const router = useRouter()
  const store = useBrowseStore()

  const filterQuery = computed(() => {
    const q: Record<string, string> = {}
    for (const p of params) {
      const val = store[p.storeKey] as string | number | null
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
      const raw = q[p.key] as string | undefined
      if (raw) {
        ;(store as any)[p.storeKey] = p.type === 'number' ? Number(raw) : raw
        hasParams = true
      }
    }

    if (store.viewMode === 'summarized') {
      ;(store as any).pageSize = 250
    }

    return hasParams
  }

  return { initFromUrl }
}
