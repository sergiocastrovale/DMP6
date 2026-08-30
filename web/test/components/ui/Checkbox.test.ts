import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import Checkbox from '../../../components/ui/Checkbox.vue'

describe('ui/Checkbox.vue', () => {
  it('reflects modelValue on the underlying input', async () => {
    const wrapper = await mountSuspended(Checkbox, { props: { modelValue: true } })
    expect((wrapper.get('input').element as HTMLInputElement).checked).toBe(true)
  })

  it('emits update:modelValue on change', async () => {
    const wrapper = await mountSuspended(Checkbox, { props: { modelValue: false } })
    const input = wrapper.get('input').element as HTMLInputElement
    input.checked = true
    await wrapper.get('input').trigger('change')
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
  })

  it('sets the indeterminate DOM property, which has no HTML attribute equivalent', async () => {
    const wrapper = await mountSuspended(Checkbox, { props: { modelValue: false, indeterminate: true } })
    expect((wrapper.get('input').element as HTMLInputElement).indeterminate).toBe(true)
  })

  it('renders the label text when provided', async () => {
    const wrapper = await mountSuspended(Checkbox, { props: { modelValue: false, label: 'Select all' } })
    expect(wrapper.text()).toContain('Select all')
  })

  it('disables the input when disabled is set', async () => {
    const wrapper = await mountSuspended(Checkbox, { props: { modelValue: false, disabled: true } })
    expect(wrapper.get('input').attributes('disabled')).toBeDefined()
  })
})
