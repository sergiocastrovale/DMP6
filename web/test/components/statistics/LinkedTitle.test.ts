import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import LinkedTitle from '../../../components/statistics/LinkedTitle.vue'

describe('statistics/LinkedTitle.vue', () => {
  it('renders a link to the artist when an artistSlug is given', async () => {
    const wrapper = await mountSuspended(LinkedTitle, { props: { title: 'OK Computer', artistSlug: 'radiohead' } })
    const link = wrapper.get('a')
    expect(link.text()).toBe('OK Computer')
    expect(link.attributes('href')).toBe('/artist/radiohead')
  })

  it('falls back to plain text when there is no artistSlug', async () => {
    const wrapper = await mountSuspended(LinkedTitle, { props: { title: 'Unknown Release', artistSlug: null } })
    expect(wrapper.find('a').exists()).toBe(false)
    expect(wrapper.text()).toBe('Unknown Release')
  })
})
