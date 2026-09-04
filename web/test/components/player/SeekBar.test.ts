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

  it('hides the inline time labels when slim', async () => {
    const wrapper = await mountSuspended(SeekBar, { props: { currentTime: 30, duration: 200, slim: true } })
    expect(wrapper.text()).not.toContain('0:30')
    expect(wrapper.text()).not.toContain('3:20')
  })

  it('opens the hover popover below the rail when popoverPlacement is bottom', async () => {
    const wrapper = await mountSuspended(SeekBar, { props: { currentTime: 30, duration: 200, hoverPopover: true, slim: true, popoverPlacement: 'bottom' } })
    await wrapper.find('.relative > div').trigger('mouseenter')
    const label = wrapper.find('.rounded-md.border')
    expect(label.text()).toBe('0:30 / 3:20')
    expect(label.classes()).toContain('top-full')
  })

  it('arrow keys seek by 5s on the non-popover rail', async () => {
    const wrapper = await mountSuspended(SeekBar, { props: { currentTime: 30, duration: 200 } })
    const bar = wrapper.find('[role="slider"]')
    await bar.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('seek')?.[0]).toEqual([35])
    await bar.trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.emitted('seek')?.[1]).toEqual([25])
  })

  it('arrow keys seek by 5s on the hover-popover rail too', async () => {
    const wrapper = await mountSuspended(SeekBar, { props: { currentTime: 30, duration: 200, hoverPopover: true } })
    const bar = wrapper.find('[role="slider"]')
    await bar.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('seek')?.[0]).toEqual([35])
  })

  it('dragging the non-popover rail follows the pointer and emits seek only on release', async () => {
    const wrapper = await mountSuspended(SeekBar, { props: { currentTime: 0, duration: 200 } })
    const bar = wrapper.find('[role="slider"]')
    vi.spyOn(bar.element, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100, right: 100, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) })
    ;(bar.element as HTMLElement).setPointerCapture = vi.fn()

    await bar.trigger('pointerdown', { clientX: 25, pointerId: 1 })
    expect(wrapper.emitted('seek')).toBeUndefined()
    expect(wrapper.text()).toContain('0:50') // dragTime follows the pointer, not currentTime

    await bar.trigger('pointermove', { clientX: 75, buttons: 1 })
    expect(wrapper.emitted('seek')).toBeUndefined()
    expect(wrapper.text()).toContain('2:30')

    await bar.trigger('pointerup')
    expect(wrapper.emitted('seek')).toEqual([[150]])
  })

  it('a pointermove with no buttons held (already released) is ignored', async () => {
    const wrapper = await mountSuspended(SeekBar, { props: { currentTime: 0, duration: 200 } })
    const bar = wrapper.find('[role="slider"]')
    vi.spyOn(bar.element, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100, right: 100, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) })
    await bar.trigger('pointermove', { clientX: 75, buttons: 0 })
    expect(wrapper.emitted('seek')).toBeUndefined()
  })
})
