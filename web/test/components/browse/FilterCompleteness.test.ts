import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import FilterCompleteness from '../../../components/browse/FilterCompleteness.vue'

describe('browse/FilterCompleteness.vue', () => {
  it('shows "Completeness" when inactive, and the band label once a range is set', async () => {
    const inactive = await mountSuspended(FilterCompleteness, { props: { minCompleteness: null, maxCompleteness: null } })
    expect(inactive.get('button').text()).toContain('Completeness')
    const active = await mountSuspended(FilterCompleteness, { props: { minCompleteness: 80, maxCompleteness: 100 } })
    expect(active.get('button').text()).toContain('80% – 100%')
  })

  it('selecting a band emits update:range with its bounds', async () => {
    const wrapper = await mountSuspended(FilterCompleteness, { props: { minCompleteness: null, maxCompleteness: null } })
    await wrapper.get('button').trigger('click')
    const option = wrapper.findAll('[role="option"]').find(o => o.text().includes('60% – 80%'))!
    await option.trigger('click')
    expect(wrapper.emitted('update:range')).toEqual([[60, 80]])
  })

  it('the clear button emits update:range(null, null) and is not nested inside the trigger', async () => {
    const wrapper = await mountSuspended(FilterCompleteness, { props: { minCompleteness: 60, maxCompleteness: 80 } })
    const clearButton = wrapper.get('[aria-label="Clear completeness filter"]')
    expect(clearButton.element.closest('button')).toBe(clearButton.element)
    await clearButton.trigger('click')
    expect(wrapper.emitted('update:range')).toEqual([[null, null]])
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const wrapper = await mountSuspended(FilterCompleteness, { props: { minCompleteness: null, maxCompleteness: null }, attachTo: document.body })
    const trigger = wrapper.get('button').element as HTMLElement
    await wrapper.get('button').trigger('click')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
  })

  it('closes when the full-screen backdrop is clicked', async () => {
    const wrapper = await mountSuspended(FilterCompleteness, { props: { minCompleteness: null, maxCompleteness: null } })
    await wrapper.get('button').trigger('click')
    const backdrop = wrapper.findAll('div').find(d => d.classes().includes('fixed'))!
    await backdrop.trigger('click')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })
})
