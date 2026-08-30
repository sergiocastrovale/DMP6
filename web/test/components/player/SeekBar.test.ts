import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import SeekBar from '../../../components/player/SeekBar.vue'

describe('player/SeekBar.vue', () => {
  it('shows elapsed time on the left and total duration on the right by default', async () => {
    const wrapper = await mountSuspended(SeekBar, { props: { currentTime: 65, duration: 200 } })
    expect(wrapper.text()).toContain('1:05')
    expect(wrapper.text()).toContain('3:20')
  })

  it('shows a counting-down remaining time when countDown is set', async () => {
    const wrapper = await mountSuspended(SeekBar, { props: { currentTime: 65, duration: 200, countDown: true } })
    expect(wrapper.text()).toContain('-2:15')
  })

  it('emits seek proportional to the click position along the track', async () => {
    const wrapper = await mountSuspended(SeekBar, { props: { currentTime: 0, duration: 200 } })
    const track = wrapper.get('[role="slider"]')
    vi.spyOn(track.element, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100, right: 100, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) })
    await track.trigger('click', { clientX: 50 })
    expect(wrapper.emitted('seek')).toEqual([[100]])
  })

  it('carries the ARIA slider value contract', async () => {
    const wrapper = await mountSuspended(SeekBar, { props: { currentTime: 65, duration: 200 } })
    const track = wrapper.get('[role="slider"]')
    expect(track.attributes('aria-valuenow')).toBe('65')
    expect(track.attributes('aria-valuemin')).toBe('0')
    expect(track.attributes('aria-valuemax')).toBe('200')
  })

  it('ArrowLeft/ArrowRight seek by 5 seconds, clamped to the track bounds', async () => {
    const wrapper = await mountSuspended(SeekBar, { props: { currentTime: 2, duration: 200 } })
    await wrapper.get('[role="slider"]').trigger('keydown', { key: 'ArrowLeft' })
    expect(wrapper.emitted('seek')![0]).toEqual([0])

    const atEnd = await mountSuspended(SeekBar, { props: { currentTime: 198, duration: 200 } })
    await atEnd.get('[role="slider"]').trigger('keydown', { key: 'ArrowRight' })
    expect(atEnd.emitted('seek')![0]).toEqual([200])
  })
})
