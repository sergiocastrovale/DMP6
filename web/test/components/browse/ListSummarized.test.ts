import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import ListSummarized from '../../../components/browse/ListSummarized.vue'
import { useBrowseStore } from '../../../stores/browse'

// setSortBy triggers store.fetchArtists(), which hits $fetch - stub it so the sort-click test doesn't
// make a real network call.
const fetchMock = vi.fn().mockResolvedValue({ items: [], total: 0, mainCount: 0, page: 1, hasMore: false })
vi.stubGlobal('$fetch', fetchMock)

const artist = (overrides: Partial<ReturnType<typeof useBrowseStore>['artists'][number]> & { id: string }) => ({
  name: 'Artist',
  slug: 'artist',
  image: null,
  imageUrl: null,
  averageMatchScore: null,
  totalPlayCount: 0,
  totalTracks: 0,
  releaseCount: 0,
  completeCount: 0,
  ...overrides,
})

const mountList = async () => {
  const wrapper = await mountSuspended(ListSummarized)
  const store = useBrowseStore()
  return { wrapper, store }
}

describe('browse/ListSummarized.vue', () => {
  it('names the unit on every count, so four numeric columns stay readable at a glance', async () => {
    const { wrapper, store } = await mountList()
    store.artists = [artist({ id: 'a1', name: 'Boards of Canada', totalTracks: 40, totalPlayCount: 12, releaseCount: 4, completeCount: 3 })]
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Boards of Canada')
    expect(wrapper.text()).toContain('4 releases')
    expect(wrapper.text()).toContain('40 tracks')
    expect(wrapper.text()).toContain('12 plays')
  })

  it('uses the singular when a count is exactly one', async () => {
    const { wrapper, store } = await mountList()
    store.artists = [artist({ id: 'a1', releaseCount: 1, completeCount: 1, totalTracks: 1, totalPlayCount: 1 })]
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('1 release')
    expect(wrapper.text()).not.toContain('1 releases')
    expect(wrapper.text()).toContain('1 track')
    expect(wrapper.text()).toContain('1 play')
  })

  it('shows the completeness fraction beside the percentage', async () => {
    // 100% off one release and 100% off forty are the same number and very different libraries.
    const { wrapper, store } = await mountList()
    store.artists = [artist({ id: 'a1', releaseCount: 4, completeCount: 3 })]
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('75%')
    expect(wrapper.text()).toContain('(3/4)')
  })

  it('shows 0% completeness (not NaN%) for an artist with zero releases', async () => {
    const { wrapper, store } = await mountList()
    store.artists = [artist({ id: 'a1', releaseCount: 0, completeCount: 0 })]
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('0%')
    expect(wrapper.text()).not.toContain('NaN')
  })

  it('reads its header arrows from the same state as the toolbar direction button', async () => {
    const { wrapper, store } = await mountList()
    store.artists = [artist({ id: 'a1' })]
    store.sortBy = 'playCount'
    store.sortDir = 'asc'
    await wrapper.vm.$nextTick()
    const playsHeader = wrapper.findAll('th').find(th => th.text().includes('Plays'))!
    expect(playsHeader.attributes('aria-sort')).toBe('ascending')
  })

  it('clicking a sortable column header calls setSortBy with that column key', async () => {
    const { wrapper, store } = await mountList()
    store.artists = [artist({ id: 'a1' })]
    await wrapper.vm.$nextTick()
    const releasesHeader = wrapper.findAll('button').find(btn => btn.text().includes('Releases'))!
    await releasesHeader.trigger('click')
    expect(store.sortBy).toBe('releases')
  })

  it('shows the empty state when there are no artists', async () => {
    const { wrapper, store } = await mountList()
    store.artists = []
    store.loading = false
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('No artists found.')
  })
})
