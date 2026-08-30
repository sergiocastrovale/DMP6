import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import Switch from '../../components/Switch.vue'

describe('Switch.vue', () => {
  it('reflects the model value via aria-checked', async () => {
    const wrapper = await mountSuspended(Switch, { props: { modelValue: true } })
    expect(wrapper.get('button').attributes('aria-checked')).toBe('true')
  })

  it('renders the label text when provided', async () => {
    const wrapper = await mountSuspended(Switch, { props: { modelValue: false, label: 'Enabled' } })
    expect(wrapper.text()).toContain('Enabled')
  })

  it('clicking the button toggles and emits update:modelValue', async () => {
    const wrapper = await mountSuspended(Switch, { props: { modelValue: false } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
  })

  it('applies the "on" background class only when checked', async () => {
    const off = await mountSuspended(Switch, { props: { modelValue: false } })
    expect(off.get('button').classes()).toContain('bg-stone-700')
    const on = await mountSuspended(Switch, { props: { modelValue: true } })
    expect(on.get('button').classes()).toContain('bg-amber-400')
  })
})
