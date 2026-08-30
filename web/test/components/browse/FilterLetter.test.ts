import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import FilterLetter from '../../../components/browse/FilterLetter.vue'

describe('browse/FilterLetter.vue', () => {
  it('renders "All" plus all 26 letters', async () => {
    const wrapper = await mountSuspended(FilterLetter, { props: { active: null } })
    const buttons = wrapper.findAll('button')
    expect(buttons).toHaveLength(27)
    expect(buttons[0]!.text()).toBe('All')
  })

  it('emits select with the lowercased letter on click', async () => {
    const wrapper = await mountSuspended(FilterLetter, { props: { active: null } })
    const bButton = wrapper.findAll('button').find(b => b.text() === 'B')!
    await bButton.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['b']])
  })

  it('emits select(null) when "All" is clicked', async () => {
    const wrapper = await mountSuspended(FilterLetter, { props: { active: 'b' } })
    await wrapper.findAll('button')[0]!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([[null]])
  })
})
