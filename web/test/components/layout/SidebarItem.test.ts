import { mountSuspended } from '@nuxt/test-utils/runtime'
import { Home } from 'lucide-vue-next'
import { describe, expect, it } from 'vitest'
import SidebarItem from '../../../components/layout/SidebarItem.vue'

describe('layout/SidebarItem.vue', () => {
  it('renders a NuxtLink (anchor) when `to` is provided', async () => {
    const wrapper = await mountSuspended(SidebarItem, {
      props: { to: '/browse', label: 'Browse', icon: Home },
    })
    expect(wrapper.find('a').exists()).toBe(true)
    expect(wrapper.text()).toContain('Browse')
  })

  it('renders a button and emits click when `to` is omitted', async () => {
    const wrapper = await mountSuspended(SidebarItem, {
      props: { label: 'Sign out', icon: Home },
    })
    expect(wrapper.find('button').exists()).toBe(true)
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('click')).toHaveLength(1)
  })

  it('marks the active item with aria-current on the link', async () => {
    const wrapper = await mountSuspended(SidebarItem, {
      props: { to: '/browse', label: 'Browse', icon: Home, active: true },
    })
    expect(wrapper.get('a').attributes('aria-current')).toBe('page')
  })

  it('does not set aria-current when inactive', async () => {
    const wrapper = await mountSuspended(SidebarItem, {
      props: { to: '/browse', label: 'Browse', icon: Home, active: false },
    })
    expect(wrapper.get('a').attributes('aria-current')).toBeUndefined()
  })

  it('hides the visible label and exposes it via title/aria-label instead when collapsed', async () => {
    const wrapper = await mountSuspended(SidebarItem, {
      props: { to: '/browse', label: 'Browse', icon: Home, collapsed: true },
    })
    expect(wrapper.text()).toBe('')
    expect(wrapper.get('a').attributes('aria-label')).toBe('Browse')
    expect(wrapper.get('a').attributes('title')).toBe('Browse')
  })

  it('shows a formatted, thousands-separated count when provided and non-zero', async () => {
    const wrapper = await mountSuspended(SidebarItem, {
      props: { to: '/browse', label: 'Browse', icon: Home, count: 22633 },
    })
    expect(wrapper.text()).toContain('22,633')
  })

  it('hides the count when it is zero', async () => {
    const wrapper = await mountSuspended(SidebarItem, {
      props: { to: '/browse', label: 'Browse', icon: Home, count: 0 },
    })
    expect(wrapper.text()).not.toContain('0')
  })
})
