import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import SaveBar from '../../../components/settings/SaveBar.vue'

describe('settings/SaveBar.vue', () => {
  it('renders no button - status is autosave-driven, not user-triggered', async () => {
    const wrapper = await mountSuspended(SaveBar, { props: { saving: false, saved: false, error: '' } })
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('shows a saving indicator while saving', async () => {
    const wrapper = await mountSuspended(SaveBar, { props: { saving: true, saved: false, error: '' } })
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('Saving')
  })

  it('announces saved/error state through a live region', async () => {
    const wrapper = await mountSuspended(SaveBar, { props: { saving: false, saved: true, error: '' } })
    const live = wrapper.get('[aria-live="polite"]')
    expect(live.text()).toContain('Saved')

    await wrapper.setProps({ saved: false, error: 'Save failed' })
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('Save failed')
  })

  it('renders extra slot content', async () => {
    const wrapper = await mountSuspended(SaveBar, {
      props: { saving: false, saved: false, error: '' },
      slots: { default: '<button class="extra">Extra</button>' },
    })
    expect(wrapper.find('.extra').exists()).toBe(true)
  })
})
