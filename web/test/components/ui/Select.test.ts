import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import Select from '../../../components/ui/Select.vue'

describe('ui/Select.vue', () => {
  it('renders option slot content', async () => {
    const wrapper = await mountSuspended(Select, {
      props: { modelValue: 'on' },
      slots: { default: '<option value="on">On</option><option value="off">Off</option>' },
    })
    expect(wrapper.findAll('option')).toHaveLength(2)
  })

  it('reflects modelValue on the underlying select', async () => {
    const wrapper = await mountSuspended(Select, {
      props: { modelValue: 'off' },
      slots: { default: '<option value="on">On</option><option value="off">Off</option>' },
    })
    expect((wrapper.get('select').element as HTMLSelectElement).value).toBe('off')
  })

  it('emits update:modelValue on change', async () => {
    const wrapper = await mountSuspended(Select, {
      props: { modelValue: 'on' },
      slots: { default: '<option value="on">On</option><option value="off">Off</option>' },
    })
    const select = wrapper.get('select')
    ;(select.element as HTMLSelectElement).value = 'off'
    await select.trigger('change')
    expect(wrapper.emitted('update:modelValue')).toEqual([['off']])
  })

  it('renders the label when provided, and omits it when not', async () => {
    const withLabel = await mountSuspended(Select, { props: { modelValue: '', label: 'Monitoring' } })
    expect(withLabel.text()).toContain('Monitoring')

    const withoutLabel = await mountSuspended(Select, { props: { modelValue: '' } })
    expect(withoutLabel.find('label').exists()).toBe(false)
  })

  it('renders the description when provided', async () => {
    const wrapper = await mountSuspended(Select, { props: { modelValue: '', description: 'Master switch.' } })
    expect(wrapper.text()).toContain('Master switch.')
  })

  it('wires aria-invalid and the error message', async () => {
    const wrapper = await mountSuspended(Select, { props: { modelValue: '', error: 'Required' } })
    expect(wrapper.get('select').attributes('aria-invalid')).toBe('true')
    expect(wrapper.text()).toContain('Required')
  })
})
