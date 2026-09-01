import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ButtonMonitor from '../../../components/artist/ButtonMonitor.vue'

describe('artist/ButtonMonitor.vue', () => {
  it('renders OFF label when not monitored', async () => {
    const wrapper = await mountSuspended(ButtonMonitor, { props: { monitored: false, busy: false } })
    expect(wrapper.text()).toContain('Monitor OFF')
  })

  it('renders ON label when monitored', async () => {
    const wrapper = await mountSuspended(ButtonMonitor, { props: { monitored: true, busy: false } })
    expect(wrapper.text()).toContain('Monitor ON')
  })

  it('emits toggle on click', async () => {
    const wrapper = await mountSuspended(ButtonMonitor, { props: { monitored: false, busy: false } })

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })
})
