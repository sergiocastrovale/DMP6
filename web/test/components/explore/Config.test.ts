import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import Config from '../../../components/explore/Config.vue'

const mountConfig = (props: Partial<{ collapsed: boolean, isLoading: boolean, error: string | null }> = {}) =>
  mountSuspended(Config, {
    props: { energy: 5, era: 5, familiarity: 4, sound: 4, ...props },
  })

describe('explore/Config.vue', () => {
  it('shows all four sliders when not collapsed', async () => {
    const wrapper = await mountConfig()
    expect(wrapper.text()).toContain('I\'m feeling...')
    expect(wrapper.text()).toContain('Era')
    expect(wrapper.text()).toContain('Discovery')
    expect(wrapper.text()).toContain('Sound')
  })

  it('shows a one-line summary built from the current stops when collapsed', async () => {
    const wrapper = await mountConfig({ collapsed: true })
    expect(wrapper.text()).toContain('Exploring')
    expect(wrapper.text()).toContain('Groovy') // energyStops[5]
    expect(wrapper.text()).toContain('Late 2000s') // eraStops[5]
    expect(wrapper.find('[role="slider"]').exists()).toBe(false)
  })

  it('emits expand when "Change" is clicked in the collapsed state', async () => {
    const wrapper = await mountConfig({ collapsed: true })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('expand')).toHaveLength(1)
  })

  it('emits explore when the Explore button is clicked', async () => {
    const wrapper = await mountConfig()
    const exploreButton = wrapper.findAll('button').find(b => b.text() === 'Explore')!
    await exploreButton.trigger('click')
    expect(wrapper.emitted('explore')).toHaveLength(1)
  })

  it('shows the error message when provided', async () => {
    const wrapper = await mountConfig({ error: 'Failed to find a track' })
    expect(wrapper.text()).toContain('Failed to find a track')
  })
})
