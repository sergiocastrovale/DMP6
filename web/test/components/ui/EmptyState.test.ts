import { mountSuspended } from '@nuxt/test-utils/runtime'
import { Search } from 'lucide-vue-next'
import { describe, expect, it } from 'vitest'
import EmptyState from '../../../components/ui/EmptyState.vue'

describe('ui/EmptyState.vue', () => {
  it('renders the message', async () => {
    const wrapper = await mountSuspended(EmptyState, { props: { message: 'No artists found.' } })
    expect(wrapper.text()).toContain('No artists found.')
  })

  it('renders an optional hint', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: { message: 'No results.', hint: 'Try a different search term.' },
    })
    expect(wrapper.text()).toContain('Try a different search term.')
  })

  it('renders the icon when provided', async () => {
    const wrapper = await mountSuspended(EmptyState, { props: { message: 'Nothing here', icon: Search } })
    expect(wrapper.findComponent(Search).exists()).toBe(true)
  })

  it('renders the action slot', async () => {
    const wrapper = await mountSuspended(EmptyState, {
      props: { message: 'Nothing here' },
      slots: { action: '<button>Run audit</button>' },
    })
    expect(wrapper.text()).toContain('Run audit')
  })
})
