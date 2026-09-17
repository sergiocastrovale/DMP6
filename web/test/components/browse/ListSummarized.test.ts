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
  completeness: null,
  totalPlayCount: 0,
  totalTracks: 0,
  releaseCount: 0,
  musicbrainzId: null,
  ...overrides,
})

const mountList = async () => {
  const wrapper = await mountSuspended(ListSummarized)
  const store = useBrowseStore()
  return { wrapper, store }
}

describe('browse/ListSummarized.vue', () => {
  it('renders each numeric column value plainly, no unit suffix', async () => {
    const { wrapper, store } = await mountList()
    store.artists = [artist({ id: 'a1', name: 'Boards of Canada', totalTracks: 40, totalPlayCount: 12, releaseCount: 4 })]
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('Boards of Canada')
    expect(wrapper.text()).toContain('4')
    expect(wrapper.text()).toContain('40')
    expect(wrapper.text()).toContain('12')
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

  it('shows the MusicBrainz ID linking out to the artist\'s MB page, or a dash when unmatched', async () => {
    const { wrapper, store } = await mountList()
    store.artists = [
      artist({ id: 'a1', musicbrainzId: 'a74b1b7f-71a5-4011-9441-d0b5e4122711' }),
      artist({ id: 'a2', musicbrainzId: null }),
    ]
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('a74b1b7f-71a5-4011-9441-d0b5e4122711')
    const link = wrapper.find('a[href="https://musicbrainz.org/artist/a74b1b7f-71a5-4011-9441-d0b5e4122711"]')
    expect(link.exists()).toBe(true)
    expect(link.attributes('target')).toBe('_blank')
  })

  it('shows the empty state when there are no artists', async () => {
    const { wrapper, store } = await mountList()
    store.artists = []
    store.loading = false
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('No artists found.')
  })
})
