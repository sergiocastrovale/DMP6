import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import SearchBar from '../../../components/layout/SearchBar.vue'

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

const RESULTS = {
  artists: [{ id: 'a1', slug: 'radiohead', name: 'Radiohead', image: null, imageUrl: null }],
  releases: [{ id: 'r1', title: 'OK Computer', year: 1997, image: null, imageUrl: null, artist: { slug: 'radiohead', name: 'Radiohead' } }],
  tracks: [],
}

describe('layout/SearchBar.vue', () => {
  it('debounces the query and fetches /api/search, opening the dropdown with results', async () => {
    const fetchMock = vi.fn().mockResolvedValue(RESULTS)
    vi.stubGlobal('$fetch', fetchMock)
    vi.useFakeTimers()
    const wrapper = await mountSuspended(SearchBar)
    await wrapper.get('input').setValue('radio')
    await vi.advanceTimersByTimeAsync(300)
    await wrapper.vm.$nextTick()
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/search?q=radio'))
    expect(wrapper.text()).toContain('Radiohead')
    vi.useRealTimers()
  })

  it('carries the ARIA combobox contract, expanding once the dropdown opens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(RESULTS)
    vi.stubGlobal('$fetch', fetchMock)
    vi.useFakeTimers()
    const wrapper = await mountSuspended(SearchBar)
    const input = wrapper.get('input')
    expect(input.attributes('role')).toBe('combobox')
    expect(input.attributes('aria-expanded')).toBe('false')
    await wrapper.get('input').setValue('radio')
    await vi.advanceTimersByTimeAsync(300)
    await wrapper.vm.$nextTick()
    expect(input.attributes('aria-expanded')).toBe('true')
    expect(input.attributes('aria-controls')).toBe(wrapper.get('[role="listbox"]').attributes('id'))
    vi.useRealTimers()
  })

  it('ArrowDown/ArrowUp move the active option and set aria-activedescendant', async () => {
    const fetchMock = vi.fn().mockResolvedValue(RESULTS)
    vi.stubGlobal('$fetch', fetchMock)
    vi.useFakeTimers()
    const wrapper = await mountSuspended(SearchBar)
    await wrapper.get('input').setValue('radio')
    await vi.advanceTimersByTimeAsync(300)
    await wrapper.vm.$nextTick()

    const input = wrapper.get('input')
    expect(input.attributes('aria-activedescendant')).toBeUndefined()
    await input.trigger('keydown', { key: 'ArrowDown' })
    const firstOptionId = wrapper.findAll('[role="option"]')[0]!.attributes('id')
    expect(input.attributes('aria-activedescendant')).toBe(firstOptionId)

    // Two results total (one artist, one release) - a second ArrowDown selects the release.
    await input.trigger('keydown', { key: 'ArrowDown' })
    const secondOptionId = wrapper.findAll('[role="option"]')[1]!.attributes('id')
    expect(input.attributes('aria-activedescendant')).toBe(secondOptionId)

    // Wraps back to the first.
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(input.attributes('aria-activedescendant')).toBe(firstOptionId)

    await input.trigger('keydown', { key: 'ArrowUp' })
    expect(input.attributes('aria-activedescendant')).toBe(secondOptionId)
    vi.useRealTimers()
  })

  it('Enter navigates to the active result and clears the query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(RESULTS)
    vi.stubGlobal('$fetch', fetchMock)
    vi.useFakeTimers()
    const wrapper = await mountSuspended(SearchBar)
    await wrapper.get('input').setValue('radio')
    await vi.advanceTimersByTimeAsync(300)
    await wrapper.vm.$nextTick()

    const input = wrapper.get('input')
    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })
    expect(navigateToMock).toHaveBeenCalledWith('/artist/radiohead')
    expect((input.element as HTMLInputElement).value).toBe('')
    vi.useRealTimers()
  })

  it('Escape closes the dropdown without clearing the query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(RESULTS)
    vi.stubGlobal('$fetch', fetchMock)
    vi.useFakeTimers()
    const wrapper = await mountSuspended(SearchBar)
    await wrapper.get('input').setValue('radio')
    await vi.advanceTimersByTimeAsync(300)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)

    await wrapper.get('input').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('radio')
    vi.useRealTimers()
  })

  it('the clear button resets the query and closes the dropdown', async () => {
    const fetchMock = vi.fn().mockResolvedValue(RESULTS)
    vi.stubGlobal('$fetch', fetchMock)
    vi.useFakeTimers()
    const wrapper = await mountSuspended(SearchBar)
    await wrapper.get('input').setValue('radio')
    await vi.advanceTimersByTimeAsync(300)
    await wrapper.vm.$nextTick()

    await wrapper.get('[aria-label="Clear search"]').trigger('click')
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    vi.useRealTimers()
  })
})
