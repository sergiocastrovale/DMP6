import { createPinia, setActivePinia } from 'pinia'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Only useRoute is stubbed - useRouter is left real. Nuxt's own bootstrap plugins (payload,
// route-announcer) call router.afterEach/beforeResolve during app init, which a plain mock object
// doesn't implement; the real (in-memory, in the `nuxt` test environment) router does.
const { routeRef } = vi.hoisted(() => ({ routeRef: { query: {} as Record<string, string> } }))
mockNuxtImport('useRoute', () => () => routeRef)

const fetchMock = vi.fn().mockResolvedValue({ artists: [], total: 0 })
vi.stubGlobal('$fetch', fetchMock)

import { useBrowseUrl } from '../../composables/useBrowseUrl'
import { useBrowseStore } from '../../stores/browse'

describe('useBrowseUrl', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    routeRef.query = {}
  })

  it('initFromUrl reads known query params into the browse store', () => {
    routeRef.query = { search: 'boards', letter: 'B', sort: 'plays' }
    const { initFromUrl } = useBrowseUrl()
    const hadParams = initFromUrl()
    expect(hadParams).toBe(true)
    const store = useBrowseStore()
    expect(store.searchQuery).toBe('boards')
    expect(store.letterFilter).toBe('B')
    expect(store.sortBy).toBe('plays')
  })

  it('initFromUrl coerces number-typed params', () => {
    routeRef.query = { minScore: '40', maxScore: '80' }
    const { initFromUrl } = useBrowseUrl()
    initFromUrl()
    const store = useBrowseStore()
    expect(store.minScore).toBe(40)
    expect(store.maxScore).toBe(80)
  })

  it('initFromUrl returns false when there are no relevant query params', () => {
    routeRef.query = { unrelated: 'x' }
    const { initFromUrl } = useBrowseUrl()
    expect(initFromUrl()).toBe(false)
  })

  it('initFromUrl bumps pageSize to 250 when mode=summarized', () => {
    routeRef.query = { mode: 'summarized' }
    const { initFromUrl } = useBrowseUrl()
    initFromUrl()
    const store = useBrowseStore()
    expect((store as unknown as { pageSize: number }).pageSize).toBe(250)
  })
})
