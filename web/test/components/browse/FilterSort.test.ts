import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import FilterSort from '../../../components/browse/FilterSort.vue'

describe('browse/FilterSort.vue', () => {
  it('shows the active sort label on the trigger', async () => {
    const wrapper = await mountSuspended(FilterSort, { props: { active: 'playCount' } })
    expect(wrapper.get('button').text()).toContain('Play count')
  })

  it('has no "All" option - sort always has exactly one active value', async () => {
    const wrapper = await mountSuspended(FilterSort, { props: { active: 'name' } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.text()).not.toContain('All')
  })

  it('emits select with the chosen sort key', async () => {
    const wrapper = await mountSuspended(FilterSort, { props: { active: 'name' } })
    await wrapper.get('button').trigger('click')
    const options = wrapper.findAll('[role="option"]')
    const scoreOption = options.find(o => o.text() === 'Match score')!
    await scoreOption.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['score']])
  })

  it('carries the listbox ARIA contract', async () => {
    const wrapper = await mountSuspended(FilterSort, { props: { active: 'name' } })
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false')
    await wrapper.get('button').trigger('click')
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)
  })
})
