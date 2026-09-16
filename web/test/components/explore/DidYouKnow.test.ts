import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'

import ExploreDidYouKnow from '../../../components/explore/DidYouKnow.vue'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.stubGlobal('$fetch', fetchMock)

// Fetches from the right endpoint and renders/hides on the fact text and Genius link - not the
// exact copy/wording around them, which is still being iterated on in components/explore/DidYouKnow.vue.
describe('explore/DidYouKnow.vue', () => {
  it('renders the fact text and Genius link once loaded', async () => {
    fetchMock.mockResolvedValueOnce({
      text: 'Paranoid Android was the first single from OK Computer.',
      sourceUrl: 'https://genius.com/Radiohead-paranoid-android-lyrics',
      release: null,
      track: { id: 't1', title: 'Paranoid Android' },
    })

    const wrapper = await mountSuspended(ExploreDidYouKnow, { props: { trackId: 't1' } })
    await vi.waitUntil(() => wrapper.text().includes('Paranoid Android was the first single'))

    expect(fetchMock).toHaveBeenCalledWith('/api/tracks/t1/fact')
    expect(wrapper.text()).toContain('Paranoid Android was the first single from OK Computer.')
    expect(wrapper.find('a[href="https://genius.com/Radiohead-paranoid-android-lyrics"]').exists()).toBe(true)
  })

  it('renders nothing when there is no fact to show', async () => {
    fetchMock.mockResolvedValueOnce(null)

    const wrapper = await mountSuspended(ExploreDidYouKnow, { props: { trackId: 't1' } })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    expect(wrapper.find('p').exists()).toBe(false)
  })

  it('renders nothing when the request fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network error'))

    const wrapper = await mountSuspended(ExploreDidYouKnow, { props: { trackId: 't1' } })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    expect(wrapper.find('p').exists()).toBe(false)
  })

  it('re-fetches when the playing track changes', async () => {
    fetchMock.mockResolvedValueOnce({ text: 'Fact about track one.', sourceUrl: null, release: null, track: null })
    const wrapper = await mountSuspended(ExploreDidYouKnow, { props: { trackId: 't1' } })
    await vi.waitUntil(() => wrapper.text().includes('Fact about track one.'))

    fetchMock.mockResolvedValueOnce({ text: 'Fact about track two.', sourceUrl: null, release: null, track: null })
    await wrapper.setProps({ trackId: 't2' })
    await vi.waitUntil(() => wrapper.text().includes('Fact about track two.'))

    expect(fetchMock).toHaveBeenLastCalledWith('/api/tracks/t2/fact')
  })
})
