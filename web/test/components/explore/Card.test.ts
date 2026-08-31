import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import Card from '../../../components/explore/Card.vue'
import { usePlayerStore } from '../../../stores/player'

const TRACK = {
  id: 't1',
  title: 'Cool Water',
  artist: 'Marty Robbins',
  album: 'Gunfighter Ballads',
  duration: 176,
  artistSlug: 'marty-robbins',
  releaseImage: null,
  releaseImageUrl: null,
  localReleaseId: 'r1',
}

describe('explore/Card.vue', () => {
  it('renders the track title, artist link and album', async () => {
    const wrapper = await mountSuspended(Card, { props: { track: TRACK } })
    expect(wrapper.text()).toContain('Cool Water')
    expect(wrapper.text()).toContain('Gunfighter Ballads')
    const artistLink = wrapper.get('a')
    expect(artistLink.text()).toBe('Marty Robbins')
    expect(artistLink.attributes('href')).toBe('/artist/marty-robbins')
  })

  it('falls back to plain text for the artist when there is no artistSlug', async () => {
    const wrapper = await mountSuspended(Card, { props: { track: { ...TRACK, artistSlug: null } } })
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.text()).toContain('Marty Robbins')
  })

  it('wires previous/play-pause/next to the player store', async () => {
    const wrapper = await mountSuspended(Card, { props: { track: TRACK } })
    const player = usePlayerStore()
    const previousSpy = vi.spyOn(player, 'previous').mockImplementation(() => {})
    const nextSpy = vi.spyOn(player, 'next').mockResolvedValue(undefined)
    const toggleSpy = vi.spyOn(player, 'togglePlay').mockImplementation(() => {})

    await wrapper.get('[aria-label="Previous track"]').trigger('click')
    expect(previousSpy).toHaveBeenCalledOnce()
    await wrapper.get('[aria-label="Next track"]').trigger('click')
    expect(nextSpy).toHaveBeenCalledOnce()
    await wrapper.get('[aria-label="Play"]').trigger('click')
    expect(toggleSpy).toHaveBeenCalledOnce()
  })

  it('has no separate "Another pick" control - Next already fetches a fresh explored track', async () => {
    const wrapper = await mountSuspended(Card, { props: { track: TRACK } })
    expect(wrapper.findAll('button').find(b => b.text().includes('Another pick'))).toBeUndefined()
  })

  it('shows the favourite toggle regardless of viewport (always-visible)', async () => {
    const wrapper = await mountSuspended(Card, { props: { track: TRACK } })
    const heart = wrapper.findComponent({ name: 'ToggleFavorite' })
    expect(heart.exists()).toBe(true)
    expect(heart.props('alwaysVisible')).toBe(true)
  })
})
