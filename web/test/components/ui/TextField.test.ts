import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import UiTextField from '../../../components/ui/TextField.vue'

describe('ui/TextField.vue', () => {
  it('associates the label with the input via a shared id', async () => {
    const wrapper = await mountSuspended(UiTextField, { props: { modelValue: '', label: 'Username' } })
    const input = wrapper.get('input')
    const label = wrapper.get('label')
    expect(label.text()).toBe('Username')
    expect(label.attributes('for')).toBe(input.attributes('id'))
  })

  it('emits update:modelValue as the user types', async () => {
    const wrapper = await mountSuspended(UiTextField, { props: { modelValue: '', label: 'Username' } })
    await wrapper.get('input').setValue('sergio')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['sergio'])
  })

  it('has no error affordance when no error is passed', async () => {
    const wrapper = await mountSuspended(UiTextField, { props: { modelValue: '', label: 'Password' } })
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('input').attributes('aria-invalid')).toBeUndefined()
    expect(wrapper.get('input').attributes('aria-describedby')).toBeUndefined()
  })

  it('renders the error as an alert wired to the input via aria-describedby', async () => {
    const wrapper = await mountSuspended(UiTextField, {
      props: { modelValue: '', label: 'Password', error: 'Invalid credentials' },
    })
    const input = wrapper.get('input')
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toBe('Invalid credentials')
    expect(input.attributes('aria-invalid')).toBe('true')
    expect(input.attributes('aria-describedby')).toBe(alert.attributes('id'))
  })

  it('defaults to a text input but supports type overrides', async () => {
    const wrapper = await mountSuspended(UiTextField, { props: { modelValue: '', label: 'Password', type: 'password' } })
    expect(wrapper.get('input').attributes('type')).toBe('password')
  })
})
