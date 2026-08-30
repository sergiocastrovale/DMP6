import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import SeekBar from '../../../components/player/SeekBar.vue'

describe('SeekBar.vue', () => {
  it('shows total duration on the right by default', async () => {
    const wrapper = await mountSuspended(SeekBar, { props: { currentTime: 30, duration: 200 } })
    expect(wrapper.text()).toContain('3:20')
  })

  it('counts down when countDown is set', async () => {
    const wrapper = await mountSuspended(SeekBar, { props: { currentTime: 30, duration: 200, countDown: true } })
    expect(wrapper.text()).toContain('-2:50')
  })

  it('does not render a popover trigger area when hoverPopover is off', async () => {
    const wrapper = await mountSuspended(SeekBar, { props: { currentTime: 30, duration: 200 } })
    expect(wrapper.text()).not.toContain('0:30 / 3:20')
  })

  it('shows a current/total readout inside the hover popover', async () => {
    const wrapper = await mountSuspended(SeekBar, { props: { currentTime: 30, duration: 200, hoverPopover: true } })
    // mouseenter doesn't bubble, and jsdom won't synthesize it on ancestors the way a real
    // pointer crossing would - Popover's listener lives on the trigger-slot wrapper, one level
    // above the slider div itself, so the event has to be dispatched there.
    await wrapper.find('.relative > div').trigger('mouseenter')
    expect(wrapper.text().replace(/\s+/g, ' ')).toContain('0:30 / 3:20')
  })

  it('emits seek on click proportional to width', async () => {
    const wrapper = await mountSuspended(SeekBar, { props: { currentTime: 0, duration: 200 } })
    const bar = wrapper.find('[role="slider"]')
    vi.spyOn(bar.element, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100, right: 100, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) })
    await bar.trigger('click', { clientX: 25 })
    expect(wrapper.emitted('seek')?.[0]).toEqual([50])
  })
})
