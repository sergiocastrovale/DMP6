import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import Block from '../../components/Block.vue'
import PlayPauseButton from '../../components/player/PlayPauseButton.vue'

mockNuxtImport('usePlayRelease', () => () => ({
  toggleOrPlay: () => {},
  isReleasePlaying: () => false,
}))

describe('Block.vue', () => {
  it('renders as a link when link is provided', async () => {
    const wrapper = await mountSuspended(Block, {
      props: { id: '1', title: 'OK Computer', subtitle: 'Radiohead', link: '/artist/radiohead' },
    })
    expect(wrapper.find('a').exists()).toBe(true)
    expect(wrapper.text()).toContain('OK Computer')
    expect(wrapper.text()).toContain('Radiohead')
  })

  it('renders as a plain article when no link is provided', async () => {
    const wrapper = await mountSuspended(Block, { props: { id: '1', title: 'OK Computer' } })
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.find('article').exists()).toBe(true)
  })

  it('shows year and genre metadata separated by a bullet', async () => {
    const wrapper = await mountSuspended(Block, {
      props: { id: '1', title: 'OK Computer', year: 1997, genre: 'Alternative Rock' },
    })
    expect(wrapper.text()).toContain('1997')
    expect(wrapper.text()).toContain('Alternative Rock')
  })

  it('renders the match score pill when a score is provided', async () => {
    const wrapper = await mountSuspended(Block, { props: { id: '1', title: 'OK Computer', score: 0.82 } })
    expect(wrapper.text()).toContain('82% match')
  })

  it('renders the play/pause control only when playable with a releaseId', async () => {
    const withoutPlayable = await mountSuspended(Block, { props: { id: '1', title: 'OK Computer' } })
    expect(withoutPlayable.findComponent(PlayPauseButton).exists()).toBe(false)

    const playable = await mountSuspended(Block, {
      props: { id: '1', title: 'OK Computer', playable: true, releaseId: 'r1' },
    })
    expect(playable.findComponent(PlayPauseButton).exists()).toBe(true)
  })
})
