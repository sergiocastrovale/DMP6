import { mountSuspended } from '@nuxt/test-utils/runtime'
import { Dna } from 'lucide-vue-next'
import { describe, expect, it } from 'vitest'
import Card from '../../../components/ui/Card.vue'

describe('ui/Card.vue', () => {
  it('renders default slot content', async () => {
    const wrapper = await mountSuspended(Card, { slots: { default: 'Card body' } })
    expect(wrapper.text()).toContain('Card body')
  })

  it('renders a sectionLabel-style title with no icon', async () => {
    const wrapper = await mountSuspended(Card, { props: { title: 'Music Library' } })
    expect(wrapper.text()).toContain('Music Library')
    expect(wrapper.get('h2').classes()).toContain('uppercase')
  })

  it('renders an icon tile and subtitle when icon is set', async () => {
    const wrapper = await mountSuspended(Card, {
      props: { title: 'Genre Genome', subtitle: 'Genre relationships via shared artists', icon: Dna },
    })
    expect(wrapper.findComponent(Dna).exists()).toBe(true)
    expect(wrapper.text()).toContain('Genre relationships via shared artists')
    expect(wrapper.get('h2').classes()).not.toContain('uppercase')
  })

  it('renders the actions slot', async () => {
    const wrapper = await mountSuspended(Card, {
      props: { title: 'Users' },
      slots: { actions: '<button>New User</button>' },
    })
    expect(wrapper.text()).toContain('New User')
  })

  it('omits the header row entirely with no title, icon, header or actions slot', async () => {
    const wrapper = await mountSuspended(Card, { slots: { default: 'Just content' } })
    expect(wrapper.find('h2').exists()).toBe(false)
  })
})
