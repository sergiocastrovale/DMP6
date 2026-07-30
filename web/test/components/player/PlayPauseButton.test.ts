import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import PlayPauseButton from '../../../components/player/PlayPauseButton.vue'

describe('PlayPauseButton.vue', () => {
  it('shows a Play affordance (aria-label) when not playing', async () => {
    const wrapper = await mountSuspended(PlayPauseButton, { props: { playing: false } })
    expect(wrapper.get('button').attributes('aria-label')).toBe('Play')
  })

  it('shows a Pause affordance when playing', async () => {
    const wrapper = await mountSuspended(PlayPauseButton, { props: { playing: true } })
    expect(wrapper.get('button').attributes('aria-label')).toBe('Pause')
  })

  it('applies the highlighted styling when highlighted=true', async () => {
    const wrapper = await mountSuspended(PlayPauseButton, { props: { highlighted: true } })
    expect(wrapper.get('button').classes()).toContain('scale-105')
  })

  it('defaults to md size classes', async () => {
    const wrapper = await mountSuspended(PlayPauseButton, {})
    expect(wrapper.get('button').classes()).toContain('size-10')
  })

  it('applies sm/lg size classes', async () => {
    const sm = await mountSuspended(PlayPauseButton, { props: { size: 'sm' } })
    expect(sm.get('button').classes()).toContain('size-8')
    const lg = await mountSuspended(PlayPauseButton, { props: { size: 'lg' } })
    expect(lg.get('button').classes()).toContain('size-11')
  })
})
