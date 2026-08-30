import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import Sidebar from '../../../components/layout/Sidebar.vue'
import { useAuth } from '../../../composables/useAuth'
import { useGlobalStore } from '../../../stores/global'

mockNuxtImport('useRequestHeaders', () => () => ({}))

const setUser = (overrides: Partial<{ role: 'ADMIN' | 'MANAGER' | 'VIEWER', permissions: string[] }> = {}) => {
  useAuth().user.value = {
    id: 1,
    username: 'admin',
    email: 'admin@test.local',
    role: overrides.role ?? 'VIEWER',
    permissions: overrides.permissions ?? [],
    mustChangePassword: false,
  }
}

describe('layout/Sidebar.vue', () => {
  it('always shows the core nav items', async () => {
    setUser()
    const wrapper = await mountSuspended(Sidebar)
    expect(wrapper.text()).toContain('Home')
    expect(wrapper.text()).toContain('Browse')
    expect(wrapper.text()).toContain('Explore')
    expect(wrapper.text()).toContain('Timeline')
    expect(wrapper.text()).toContain('Labs')
    expect(wrapper.text()).toContain('Statistics')
    expect(wrapper.text()).toContain('Sign out')
  })

  it('hides permission-gated items for a viewer with no extra permissions', async () => {
    setUser({ permissions: [] })
    const wrapper = await mountSuspended(Sidebar)
    expect(wrapper.text()).not.toContain('Playlists')
    expect(wrapper.text()).not.toContain('Favorites')
    expect(wrapper.text()).not.toContain('Downloads')
    expect(wrapper.text()).not.toContain('Issues')
    expect(wrapper.text()).not.toContain('Settings')
  })

  it('shows permission-gated items once granted', async () => {
    setUser({ permissions: ['playlists.view', 'favorites.view', 'sync.view', 'issues.view'] })
    const wrapper = await mountSuspended(Sidebar)
    expect(wrapper.text()).toContain('Playlists')
    expect(wrapper.text()).toContain('Favorites')
    expect(wrapper.text()).toContain('Downloads')
    expect(wrapper.text()).toContain('Issues')
  })

  it('shows Settings only for an admin', async () => {
    setUser({ role: 'VIEWER' })
    const viewer = await mountSuspended(Sidebar)
    expect(viewer.text()).not.toContain('Settings')

    setUser({ role: 'ADMIN' })
    const admin = await mountSuspended(Sidebar)
    expect(admin.text()).toContain('Settings')
  })

  it('shows the artist count next to Browse once the global store has loaded stats', async () => {
    setUser()
    const global = useGlobalStore()
    global.stats.artists = 22633
    const wrapper = await mountSuspended(Sidebar)
    expect(wrapper.text()).toContain('22,633')
  })

  it('calls logout when Sign out is clicked', async () => {
    setUser()
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({}))
    const wrapper = await mountSuspended(Sidebar)
    const signOut = wrapper.findAll('button').find(b => b.text() === 'Sign out')!
    await signOut.trigger('click')
    expect(useAuth().user.value).toBeNull()
  })

  it('the collapse toggle flips the sidebar between expanded and collapsed', async () => {
    setUser()
    const wrapper = await mountSuspended(Sidebar)
    expect(wrapper.text()).toContain('Home')
    await wrapper.get('[aria-label="Collapse sidebar"]').trigger('click')
    expect(wrapper.find('[aria-label="Expand sidebar"]').exists()).toBe(true)
  })
})
