import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import Filters from '../../../components/browse/Filters.vue'
import { useBrowseStore } from '../../../stores/browse'

// Filters.vue fetches artists on mount (page-1 load) and BrowseFiltersGenre fetches genres as soon
// as the sidebar's markup exists - stub $fetch so neither hits the network. mountSuspended also
// reuses one Nuxt app/Pinia instance across every test in this file, so each test sets the store
// state it needs explicitly rather than assuming a fresh-store default.
const fetchMock = vi.fn().mockResolvedValue({ items: [], total: 0, mainCount: 0, page: 1, hasMore: false })
vi.stubGlobal('$fetch', fetchMock)

describe('browse/Filters.vue', () => {

  it('shows no count badge and no "Clear" button when nothing is active', async () => {
    const wrapper = await mountSuspended(Filters)
    const store = useBrowseStore()
    store.genreFilters = []
    store.minCompleteness = null
    store.maxCompleteness = null
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain('Clear')
    const filtersButton = wrapper.findAll('button').find(b => b.text().includes('Filters'))!
    expect(filtersButton.text()).not.toMatch(/Filters\s*\d/)
  })

  it('shows the active filter count and a "Clear" button once a genre is checked', async () => {
    const wrapper = await mountSuspended(Filters)
    const store = useBrowseStore()
    store.genreFilters = ['Ambient']
    await wrapper.vm.$nextTick()
    const filtersButton = wrapper.findAll('button').find(b => b.text().includes('Filters'))!
    expect(filtersButton.text()).toContain('1')
    expect(wrapper.text()).toContain('Clear')
  })

  it('clicking "Clear" calls the store\'s clearFilters', async () => {
    const wrapper = await mountSuspended(Filters)
    const store = useBrowseStore()
    store.genreFilters = ['Ambient']
    await wrapper.vm.$nextTick()
    const clearButton = wrapper.findAll('button').find(b => b.text().includes('Clear'))!
    await clearButton.trigger('click')
    expect(store.genreFilters).toEqual([])
  })

  it('clicking the Filters button opens the sidebar', async () => {
    // FiltersSidebar renders via <Teleport to="body">, so its content lands outside the mounted
    // wrapper's own DOM subtree - query document.body directly, same as Dialog.test.ts.
    const wrapper = await mountSuspended(Filters)
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
    const filtersButton = wrapper.findAll('button').find(b => b.text().includes('Filters'))!
    await filtersButton.trigger('click')
    await wrapper.vm.$nextTick()
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull()
    wrapper.unmount()
    document.body.innerHTML = ''
  })
})
