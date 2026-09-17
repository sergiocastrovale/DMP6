import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FiltersSidebar from '../../../components/browse/FiltersSidebar.vue'
import { useBrowseStore } from '../../../stores/browse'

// FiltersSidebar renders via <Teleport to="body">, so its content lands outside the mounted
// wrapper's own DOM subtree - query document.body directly, same as Dialog.test.ts. mountSuspended
// also reuses one Nuxt app/Pinia instance across every test in this file (setActivePinia doesn't
// reach the store a mounted component resolves), so each test either sets the state it needs
// explicitly or - for sortDir's binary toggle - asserts relative to whatever it started at, rather
// than assuming a fresh-store default.
const fetchMock = vi.fn().mockResolvedValue([])
vi.stubGlobal('$fetch', fetchMock)

const bodyButtons = (text: string) => [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === text)

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
  document.body.style.overflow = ''
})

describe('browse/FiltersSidebar.vue', () => {
  it('renders nothing when closed', async () => {
    wrapper = await mountSuspended(FiltersSidebar, { props: { modelValue: false } })
    expect(document.body.querySelector('[role="dialog"]')).toBeNull()
  })

  it('clicking a sort pair chip sets both the column and its explicit direction', async () => {
    wrapper = await mountSuspended(FiltersSidebar, { props: { modelValue: true } })
    const store = useBrowseStore()
    bodyButtons('Fewest tracks')!.click()
    expect(store.sortBy).toBe('tracks')
    expect(store.sortDir).toBe('asc')
    bodyButtons('Most tracks')!.click()
    expect(store.sortBy).toBe('tracks')
    expect(store.sortDir).toBe('desc')
  })

  it('clicking a completeness band sets its range, clicking it again clears it', async () => {
    wrapper = await mountSuspended(FiltersSidebar, { props: { modelValue: true } })
    const store = useBrowseStore()
    const band = bodyButtons('80% – 100%')!
    band.click()
    expect(store.minCompleteness).toBe(80)
    expect(store.maxCompleteness).toBe(100)
    band.click()
    expect(store.minCompleteness).toBeNull()
    expect(store.maxCompleteness).toBeNull()
  })

  it('shows "Clear all" only once a filter is active, and it resets genres/completeness', async () => {
    wrapper = await mountSuspended(FiltersSidebar, { props: { modelValue: true } })
    const store = useBrowseStore()
    store.genreFilters = []
    store.minCompleteness = null
    store.maxCompleteness = null
    await wrapper.vm.$nextTick()
    expect(bodyButtons('Clear all')).toBeUndefined()
    store.genreFilters = ['Ambient']
    await wrapper.vm.$nextTick()
    bodyButtons('Clear all')!.click()
    expect(store.genreFilters).toEqual([])
  })

  it('closes on Escape', async () => {
    wrapper = await mountSuspended(FiltersSidebar, { props: { modelValue: true } })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('closes when the scrim behind the panel is clicked', async () => {
    wrapper = await mountSuspended(FiltersSidebar, { props: { modelValue: true } })
    // Not `[role="dialog"]`'s `.parentElement` - vue-test-utils stubs <Transition> as a real
    // <transition-stub> wrapper element in tests (it's transparent in a real browser), so the
    // dialog's actual DOM parent here is that stub, not the outer scrim div.
    const scrim = document.body.querySelector('.fixed.inset-0') as HTMLElement
    scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
  })

  it('shows a spinner in the header while the store is refreshing results', async () => {
    wrapper = await mountSuspended(FiltersSidebar, { props: { modelValue: true } })
    const store = useBrowseStore()
    store.loading = true
    await wrapper.vm.$nextTick()
    expect(document.body.querySelector('[role="dialog"] svg.animate-spin')).not.toBeNull()
  })
})
