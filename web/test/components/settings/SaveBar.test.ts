import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import SaveBar from '../../../components/settings/SaveBar.vue'

describe('settings/SaveBar.vue', () => {
  it('emits save when the button is clicked', async () => {
    const wrapper = await mountSuspended(SaveBar, { props: { saving: false, saved: false, error: '' } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('save')).toHaveLength(1)
  })

  it('disables the button while saving or when disabled is set', async () => {
    const saving = await mountSuspended(SaveBar, { props: { saving: true, saved: false, error: '' } })
    expect(saving.get('button').attributes('disabled')).toBeDefined()

    const disabled = await mountSuspended(SaveBar, { props: { saving: false, saved: false, error: '', disabled: true } })
    expect(disabled.get('button').attributes('disabled')).toBeDefined()
  })

  it('announces saved/error state through a live region', async () => {
    const wrapper = await mountSuspended(SaveBar, { props: { saving: false, saved: true, error: '' } })
    const live = wrapper.get('[aria-live="polite"]')
    expect(live.text()).toContain('Saved')

    await wrapper.setProps({ saved: false, error: 'Save failed' })
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('Save failed')
  })

  it('renders a custom label and extra slot content', async () => {
    const wrapper = await mountSuspended(SaveBar, {
      props: { saving: false, saved: false, error: '', label: 'Save' },
      slots: { default: '<button class="extra">Extra</button>' },
    })
    expect(wrapper.get('button').text()).toBe('Save')
    expect(wrapper.find('.extra').exists()).toBe(true)
  })
})
