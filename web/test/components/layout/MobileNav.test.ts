import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import MobileNav from '../../../components/layout/MobileNav.vue'
import { useAuth } from '../../../composables/useAuth'

mockNuxtImport('useRequestHeaders', () => () => ({}))

const setUser = (overrides: Partial<{ role: 'ADMIN' | 'VIEWER', permissions: string[] }> = {}) => {
  useAuth().user.value = {
    id: 1,
    username: 'admin',
    email: 'admin@test.local',
    role: overrides.role ?? 'VIEWER',
    permissions: overrides.permissions ?? [],
    mustChangePassword: false,
  }
}

describe('layout/MobileNav.vue', () => {
  it('shows the core bottom-bar items', async () => {
    setUser()
    const wrapper = await mountSuspended(MobileNav)
    expect(wrapper.text()).toContain('Home')
    expect(wrapper.text()).toContain('Browse')
    expect(wrapper.text()).toContain('Explore')
    expect(wrapper.text()).toContain('More')
  })

  it('opens the "More" sheet on click, listing the overflow groups', async () => {
    setUser({ permissions: ['issues.view'] })
    const wrapper = await mountSuspended(MobileNav)
    expect(document.body.textContent).not.toContain('Timeline')
    await wrapper.get('button').trigger('click')
    expect(document.body.textContent).toContain('Timeline')
    expect(document.body.textContent).toContain('Labs')
    expect(document.body.textContent).toContain('Statistics')
    expect(document.body.textContent).toContain('Issues')
    wrapper.unmount()
    document.body.innerHTML = ''
  })

  it('hides Settings from a non-admin and shows it for an admin', async () => {
    setUser({ role: 'VIEWER' })
    const viewer = await mountSuspended(MobileNav)
    await viewer.get('button').trigger('click')
    expect(document.body.textContent).not.toContain('Settings')
    viewer.unmount()
    document.body.innerHTML = ''

    setUser({ role: 'ADMIN' })
    const admin = await mountSuspended(MobileNav)
    await admin.get('button').trigger('click')
    expect(document.body.textContent).toContain('Settings')
    admin.unmount()
    document.body.innerHTML = ''
  })

  it('signing out calls logout and closes the sheet', async () => {
    setUser()
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({}))
    const wrapper = await mountSuspended(MobileNav)
    await wrapper.get('button').trigger('click')
    const signOut = [...document.body.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Sign out')!
    signOut.click()
    await wrapper.vm.$nextTick()
    expect(useAuth().user.value).toBeNull()
    wrapper.unmount()
    document.body.innerHTML = ''
  })
})
