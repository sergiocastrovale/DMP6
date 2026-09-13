import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import UiTextArea from '../../../components/ui/TextArea.vue'

describe('ui/TextArea.vue', () => {
  it('associates the label with the textarea via a shared id', async () => {
    const wrapper = await mountSuspended(UiTextArea, { props: { modelValue: '', label: 'Description' } })
    const textarea = wrapper.get('textarea')
    const label = wrapper.get('label')
    expect(label.text()).toBe('Description')
    expect(label.attributes('for')).toBe(textarea.attributes('id'))
  })

  it('renders with no label when none is passed', async () => {
    const wrapper = await mountSuspended(UiTextArea, { props: { modelValue: '' } })
    expect(wrapper.find('label').exists()).toBe(false)
  })

  it('emits update:modelValue as the user types', async () => {
    const wrapper = await mountSuspended(UiTextArea, { props: { modelValue: '' } })
    await wrapper.get('textarea').setValue('rock\ngrunge')
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['rock\ngrunge'])
  })

  it('renders the error as an alert wired to the textarea via aria-describedby', async () => {
    const wrapper = await mountSuspended(UiTextArea, {
      props: { modelValue: '', label: 'Terms', error: 'Required' },
    })
    const textarea = wrapper.get('textarea')
    const alert = wrapper.get('[role="alert"]')
    expect(alert.text()).toBe('Required')
    expect(textarea.attributes('aria-invalid')).toBe('true')
    expect(textarea.attributes('aria-describedby')).toBe(alert.attributes('id'))
  })
})
