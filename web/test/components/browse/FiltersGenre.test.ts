import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FiltersGenre from '../../../components/browse/FiltersGenre.vue'
import { useBrowseStore } from '../../../stores/browse'

const TOP5 = [
  { id: 'g1', name: 'Alternative Rock', artistCount: 900 },
  { id: 'g2', name: 'Indie Rock', artistCount: 800 },
  { id: 'g3', name: 'Electronic', artistCount: 700 },
  { id: 'g4', name: 'Ambient', artistCount: 600 },
  { id: 'g5', name: 'Experimental', artistCount: 500 },
]

describe('browse/FiltersGenre.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  it('loads the 5 most common genres with no search term', async () => {
    const fetchMock = vi.fn().mockResolvedValue(TOP5)
    vi.stubGlobal('$fetch', fetchMock)
    const wrapper = await mountSuspended(FiltersGenre)
    await vi.runAllTimersAsync()
    expect(fetchMock).toHaveBeenCalledWith('/api/genres', expect.objectContaining({
      params: expect.objectContaining({ search: undefined, limit: 5 }),
    }))
    expect(wrapper.text()).toContain('Alternative Rock')
    expect(wrapper.text()).toContain('Experimental')
  })

  it('debounces search input before querying', async () => {
    const fetchMock = vi.fn().mockResolvedValue(TOP5)
    vi.stubGlobal('$fetch', fetchMock)
    const wrapper = await mountSuspended(FiltersGenre)
    await vi.runAllTimersAsync()
    fetchMock.mockClear()

    const input = wrapper.get('input')
    await input.setValue('amb')
    expect(fetchMock).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(fetchMock).toHaveBeenCalledWith('/api/genres', expect.objectContaining({
      params: expect.objectContaining({ search: 'amb', limit: 5 }),
    }))
  })

  it('shows a spinner while a query is in flight', async () => {
    let resolveFetch: (v: unknown) => void
    const fetchMock = vi.fn().mockReturnValue(new Promise((resolve) => { resolveFetch = resolve }))
    vi.stubGlobal('$fetch', fetchMock)
    const wrapper = await mountSuspended(FiltersGenre)
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('svg.animate-spin').exists()).toBe(true)
    resolveFetch!(TOP5)
    await vi.runAllTimersAsync()
    expect(wrapper.find('svg.animate-spin').exists()).toBe(false)
  })

  it('toggling a checkbox calls the store\'s toggleGenre', async () => {
    const fetchMock = vi.fn().mockResolvedValue(TOP5)
    vi.stubGlobal('$fetch', fetchMock)
    const wrapper = await mountSuspended(FiltersGenre)
    await vi.runAllTimersAsync()
    const store = useBrowseStore()
    const ambientCheckbox = wrapper.findAll('input[type="checkbox"]')[3]!
    await ambientCheckbox.setValue(true)
    expect(store.genreFilters).toEqual(['Ambient'])
  })

  it('a request aborted by a newer keystroke resolves quietly instead of throwing (regression: unhandled rejection)', async () => {
    // ofetch wraps an AbortController.abort() as its own FetchError, whose .name is 'FetchError' -
    // the actual AbortError lives at .cause. Reproduces the live "Uncaught (in promise) FetchError
    // ... Caused by: AbortError" seen from rapid genre-filter typing/toggling.
    const fetchMock = vi.fn().mockResolvedValueOnce(TOP5)
    vi.stubGlobal('$fetch', fetchMock)
    const wrapper = await mountSuspended(FiltersGenre)
    await vi.runAllTimersAsync()

    const abortFetchError = Object.assign(new Error('aborted'), {
      name: 'FetchError',
      cause: new DOMException('signal is aborted without reason', 'AbortError'),
    })
    fetchMock.mockRejectedValueOnce(abortFetchError)
    await wrapper.get('input').setValue('sho')
    // Throws (fails the test) if the abort error escapes the component's catch.
    await vi.runAllTimersAsync()
  })

  it('pins a checked genre above the current results even once it falls out of a narrowed search', async () => {
    const fetchMock = vi.fn().mockResolvedValue(TOP5)
    vi.stubGlobal('$fetch', fetchMock)
    const wrapper = await mountSuspended(FiltersGenre)
    await vi.runAllTimersAsync()
    const store = useBrowseStore()
    store.genreFilters = ['Ambient']

    fetchMock.mockResolvedValue([{ id: 'g6', name: 'Shoegaze', artistCount: 40 }])
    await wrapper.get('input').setValue('shoe')
    await vi.runAllTimersAsync()

    expect(wrapper.text()).toContain('Ambient')
    expect(wrapper.text()).toContain('Shoegaze')
    const checkboxes = wrapper.findAll('input[type="checkbox"]')
    expect(checkboxes).toHaveLength(2)
    expect((checkboxes[0]!.element as HTMLInputElement).checked).toBe(true)
  })
})
