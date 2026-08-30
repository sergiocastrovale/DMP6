import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import RadioGroup from '../../components/RadioGroup.vue'

const OPTIONS = [
  { value: 'chronological', label: 'Chronological' },
  { value: 'gradient', label: 'Gradient' },
]

describe('RadioGroup.vue', () => {
  it('carries the radiogroup/radio roles and marks the checked option', async () => {
    const wrapper = await mountSuspended(RadioGroup, { props: { options: OPTIONS, modelValue: 'gradient' } })
    expect(wrapper.find('[role="radiogroup"]').exists()).toBe(true)
    const radios = wrapper.findAll('[role="radio"]')
    expect(radios[0]!.attributes('aria-checked')).toBe('false')
    expect(radios[1]!.attributes('aria-checked')).toBe('true')
  })

  it('only the checked option is in the tab order', async () => {
    const wrapper = await mountSuspended(RadioGroup, { props: { options: OPTIONS, modelValue: 'chronological' } })
    const radios = wrapper.findAll('[role="radio"]')
    expect(radios.map(r => r.attributes('tabindex'))).toEqual(['0', '-1'])
  })

  it('clicking an option updates the model', async () => {
    const wrapper = await mountSuspended(RadioGroup, { props: { options: OPTIONS, modelValue: 'chronological' } })
    await wrapper.findAll('[role="radio"]')[1]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['gradient']])
  })

  it('ArrowRight/ArrowLeft move selection and wrap around', async () => {
    const wrapper = await mountSuspended(RadioGroup, { props: { options: OPTIONS, modelValue: 'gradient' } })
    await wrapper.get('[role="radiogroup"]').trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['chronological']])
  })

  it('Home and End jump to the first and last option', async () => {
    const wrapper = await mountSuspended(RadioGroup, { props: { options: OPTIONS, modelValue: 'gradient' } })
    await wrapper.get('[role="radiogroup"]').trigger('keydown', { key: 'Home' })
    await wrapper.get('[role="radiogroup"]').trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('update:modelValue')).toEqual([['chronological'], ['gradient']])
  })
})
