import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import Genres from '../../../components/artist/Genres.vue'

const genre = (id: string, name: string) => ({ id, name })

describe('artist/Genres.vue', () => {
  it('renders every genre up to the max without a "more" button', async () => {
    const genres = [genre('1', 'Rock'), genre('2', 'Pop')]
    const wrapper = await mountSuspended(Genres, { props: { genres } })
    expect(wrapper.text()).toContain('Rock')
    expect(wrapper.text()).toContain('Pop')
    expect(wrapper.text()).not.toContain('more')
  })

  it('caps visible genres at the max and shows a "+N more" button beyond it', async () => {
    const genres = Array.from({ length: 8 }, (_, i) => genre(String(i), `Genre ${i}`))
    const wrapper = await mountSuspended(Genres, { props: { genres } })
    expect(wrapper.findAll('a')).toHaveLength(4)
    expect(wrapper.text()).toContain('+4 more')
  })

  it('emits "seeAll" when the overflow button is clicked', async () => {
    const genres = Array.from({ length: 8 }, (_, i) => genre(String(i), `Genre ${i}`))
    const wrapper = await mountSuspended(Genres, { props: { genres } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('seeAll')).toHaveLength(1)
  })
})
