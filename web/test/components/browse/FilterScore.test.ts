import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import FilterScore from '../../../components/browse/FilterScore.vue'

describe('browse/FilterScore.vue', () => {
  it('shows "Match Score" when inactive, and the band label once a range is set', async () => {
    const inactive = await mountSuspended(FilterScore, { props: { minScore: null, maxScore: null } })
    expect(inactive.get('button').text()).toContain('Match Score')
    const active = await mountSuspended(FilterScore, { props: { minScore: 80, maxScore: 100 } })
    expect(active.get('button').text()).toContain('80% – 100%')
  })

  it('selecting a band emits update:range with its bounds', async () => {
    const wrapper = await mountSuspended(FilterScore, { props: { minScore: null, maxScore: null } })
    await wrapper.get('button').trigger('click')
    const option = wrapper.findAll('[role="option"]').find(o => o.text().includes('60% – 80%'))!
    await option.trigger('click')
    expect(wrapper.emitted('update:range')).toEqual([[60, 80]])
  })

  it('the clear button emits update:range(null, null) and is not nested inside the trigger', async () => {
    const wrapper = await mountSuspended(FilterScore, { props: { minScore: 60, maxScore: 80 } })
    const clearButton = wrapper.get('[aria-label="Clear match score filter"]')
    expect(clearButton.element.closest('button')).toBe(clearButton.element)
    await clearButton.trigger('click')
    expect(wrapper.emitted('update:range')).toEqual([[null, null]])
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const wrapper = await mountSuspended(FilterScore, { props: { minScore: null, maxScore: null }, attachTo: document.body })
    const trigger = wrapper.get('button').element as HTMLElement
    await wrapper.get('button').trigger('click')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
  })

  it('closes when the full-screen backdrop is clicked', async () => {
    const wrapper = await mountSuspended(FilterScore, { props: { minScore: null, maxScore: null } })
    await wrapper.get('button').trigger('click')
    const backdrop = wrapper.findAll('div').find(d => d.classes().includes('fixed'))!
    await backdrop.trigger('click')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })
})
