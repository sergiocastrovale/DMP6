import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import SettingsField from '../../../components/settings/SettingsField.vue'

describe('settings/SettingsField.vue', () => {
  it('associates the label with the input via a shared id', async () => {
    const wrapper = await mountSuspended(SettingsField, { props: { label: 'Music Directory', modelValue: '' } })
    const input = wrapper.get('input')
    const label = wrapper.get('label')
    expect(label.text()).toBe('Music Directory')
    expect(label.attributes('for')).toBe(input.attributes('id'))
  })

  it('renders a select with a chevron and an env-default option when type is select', async () => {
    const wrapper = await mountSuspended(SettingsField, {
      props: {
        label: 'Storage Mode',
        modelValue: '',
        type: 'select',
        options: [{ value: 's3', label: 'S3 only' }],
      },
    })
    const select = wrapper.get('select')
    expect(select.attributes('id')).toBe(wrapper.get('label').attributes('for'))
    const options = select.findAll('option').map(o => o.text())
    expect(options).toEqual(['- use env default -', 'S3 only'])
    expect(wrapper.find('svg').exists()).toBe(true)
  })

  it('emits update:modelValue as the user types', async () => {
    const wrapper = await mountSuspended(SettingsField, { props: { label: 'API Key', modelValue: '' } })
    await wrapper.get('input').setValue('abc123')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['abc123'])
  })
})
