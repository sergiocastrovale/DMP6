import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'

import ArtistDidYouKnow from '../../../components/artist/DidYouKnow.vue'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.stubGlobal('$fetch', fetchMock)

describe('artist/DidYouKnow.vue', () => {
  it('renders the title, fact text and subject once loaded', async () => {
    fetchMock.mockResolvedValueOnce({
      text: 'They formed in 1985 as On A Friday.',
      sourceUrl: 'https://genius.com/artists/Radiohead',
      release: null,
      track: { id: 't1', title: 'Paranoid Android' },
    })

    const wrapper = await mountSuspended(ArtistDidYouKnow, { props: { slug: 'radiohead' } })
    await vi.waitUntil(() => wrapper.text().includes('On A Friday'))

    expect(wrapper.text()).toContain('Did you know...')
    expect(wrapper.text()).toContain('They formed in 1985 as On A Friday.')
    expect(wrapper.text()).toContain('Paranoid Android')
    expect(wrapper.find('a[href="https://genius.com/artists/Radiohead"]').exists()).toBe(true)
  })

  it('renders nothing when there is no fact to show', async () => {
    fetchMock.mockResolvedValueOnce(null)

    const wrapper = await mountSuspended(ArtistDidYouKnow, { props: { slug: 'radiohead' } })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    expect(wrapper.text()).not.toContain('Did you know')
  })

  it('renders nothing when the request fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network error'))

    const wrapper = await mountSuspended(ArtistDidYouKnow, { props: { slug: 'radiohead' } })
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled())

    expect(wrapper.text()).not.toContain('Did you know')
  })
})
