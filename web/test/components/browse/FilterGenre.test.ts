import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import FilterGenre from '../../../components/browse/FilterGenre.vue'

const GENRES = [
  { id: 'g1', name: 'Shoegaze', artistCount: 12 },
  { id: 'g2', name: 'Post-Rock', artistCount: 8 },
]

describe('browse/FilterGenre.vue', () => {
  it('shows "Genre" when nothing is active, and the genre name once one is', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(GENRES))
    const none = await mountSuspended(FilterGenre, { props: { active: null } })
    expect(none.get('button').text()).toContain('Genre')
    const active = await mountSuspended(FilterGenre, { props: { active: 'Shoegaze' } })
    expect(active.get('button').text()).toContain('Shoegaze')
  })

  it('opens the dropdown and emits select for a genre', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(GENRES))
    const wrapper = await mountSuspended(FilterGenre, { props: { active: null } })
    await wrapper.get('button').trigger('click')
    await wrapper.vm.$nextTick()
    const option = wrapper.findAll('[role="option"]').find(o => o.text().includes('Post-Rock'))!
    await option.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['Post-Rock']])
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(GENRES))
    const wrapper = await mountSuspended(FilterGenre, { props: { active: null }, attachTo: document.body })
    const trigger = wrapper.get('button').element as HTMLElement
    await wrapper.get('button').trigger('click')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
  })

  it('closes when the full-screen backdrop behind the dropdown is clicked', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(GENRES))
    const wrapper = await mountSuspended(FilterGenre, { props: { active: null } })
    await wrapper.get('button').trigger('click')
    const backdrop = wrapper.findAll('div').find(d => d.classes().includes('fixed'))!
    await backdrop.trigger('click')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('clicking the clear button emits select(null) without opening the dropdown', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(GENRES))
    const wrapper = await mountSuspended(FilterGenre, { props: { active: 'Shoegaze' } })
    await wrapper.get('[aria-label="Clear genre filter"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[null]])
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('the clear button is not nested inside the trigger button (keyboard-reachable, valid HTML)', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(GENRES))
    const wrapper = await mountSuspended(FilterGenre, { props: { active: 'Shoegaze' } })
    const clearButton = wrapper.get('[aria-label="Clear genre filter"]')
    expect(clearButton.element.closest('button')).toBe(clearButton.element)
  })
})
