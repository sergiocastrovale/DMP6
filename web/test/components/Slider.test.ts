import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import Slider from '../../components/Slider.vue'

const STOPS = ['Tired', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'Powerful']

const mountSlider = (modelValue = 5) => mountSuspended(Slider, {
  props: {
    modelValue,
    leftLabel: 'Tired',
    rightLabel: 'Powerful',
    title: 'Energy',
    stops: STOPS,
  },
})

describe('Slider.vue', () => {
  it('carries the full ARIA slider contract', async () => {
    const wrapper = await mountSlider(5)
    const track = wrapper.get('[role="slider"]')
    expect(track.attributes('aria-valuenow')).toBe('5')
    expect(track.attributes('aria-valuemin')).toBe('0')
    expect(track.attributes('aria-valuemax')).toBe('9')
    expect(track.attributes('aria-valuetext')).toBe('E')
    expect(track.attributes('aria-label')).toBe('Energy')
    expect(track.attributes('tabindex')).toBe('0')
  })

  it('displays the label for the current stop', async () => {
    const wrapper = await mountSlider(0)
    expect(wrapper.text()).toContain('Tired')
  })

  it.each([
    ['ArrowRight', 6],
    ['ArrowUp', 6],
    ['ArrowLeft', 4],
    ['ArrowDown', 4],
  ])('%s moves the value by one step', async (key, expected) => {
    const wrapper = await mountSlider(5)
    await wrapper.get('[role="slider"]').trigger('keydown', { key })
    expect(wrapper.emitted('update:modelValue')).toEqual([[expected]])
  })

  it('Home jumps to the minimum and End jumps to the maximum', async () => {
    const wrapper = await mountSlider(5)
    await wrapper.get('[role="slider"]').trigger('keydown', { key: 'Home' })
    await wrapper.get('[role="slider"]').trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('update:modelValue')).toEqual([[0], [9]])
  })

  it('never emits past the configured bounds', async () => {
    const atMax = await mountSlider(9)
    await atMax.get('[role="slider"]').trigger('keydown', { key: 'ArrowRight' })
    expect(atMax.emitted('update:modelValue')).toEqual([[9]])

    const atMin = await mountSlider(0)
    await atMin.get('[role="slider"]').trigger('keydown', { key: 'ArrowLeft' })
    expect(atMin.emitted('update:modelValue')).toEqual([[0]])
  })

  it('sets the value from a pointerdown position along the track', async () => {
    const wrapper = await mountSlider(0)
    const track = wrapper.get('[role="slider"]').element as HTMLElement
    track.getBoundingClientRect = () => ({ left: 0, width: 100, right: 100, top: 0, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) })
    await wrapper.get('[role="slider"]').trigger('pointerdown', { clientX: 90 })
    // 90% of a 0-9 range rounds to step 8.
    expect(wrapper.emitted('update:modelValue')).toEqual([[8]])
  })
})
