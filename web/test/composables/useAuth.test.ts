import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)
mockNuxtImport('useRequestHeaders', () => () => ({}))
mockNuxtImport('useState', () => {
  const state = new Map<string, ReturnType<typeof ref>>()
  return (key: string, init: () => unknown) => {
    if (!state.has(key)) state.set(key, ref(init()))
    return state.get(key)!
  }
})

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

import { useAuth } from '../../composables/useAuth'

describe('useAuth', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    navigateToMock.mockReset()
    useAuth().user.value = null
  })

  it('isLoggedIn/isAdmin/isManager reflect the current user state', () => {
    const auth = useAuth()
    expect(auth.isLoggedIn.value).toBe(false)
    auth.user.value = { id: 1, username: 'admin', email: 'admin@test.local', role: 'ADMIN', permissions: [], mustChangePassword: false }
    expect(auth.isLoggedIn.value).toBe(true)
    expect(auth.isAdmin.value).toBe(true)
    expect(auth.isManager.value).toBe(false)
  })

  it('hasPerm checks the permissions array', () => {
    const auth = useAuth()
    auth.user.value = { id: 1, username: 'x', email: 'x@test.local', role: 'VIEWER', permissions: ['play.view'], mustChangePassword: false }
    expect(auth.hasPerm('play.view').value).toBe(true)
    expect(auth.hasPerm('sync.view').value).toBe(false)
  })

  it('hasPerm is false with no user', () => {
    expect(useAuth().hasPerm('play.view').value).toBe(false)
  })

  it('loadMe sets the user on success', async () => {
    fetchMock.mockResolvedValue({ id: 1, username: 'admin', role: 'ADMIN', permissions: [], mustChangePassword: false })
    const auth = useAuth()
    await auth.loadMe()
    expect(auth.user.value?.username).toBe('admin')
  })

  it('loadMe clears the user on failure (e.g. 401)', async () => {
    fetchMock.mockRejectedValue(new Error('401'))
    const auth = useAuth()
    auth.user.value = { id: 1, username: 'x', email: 'x@test.local', role: 'VIEWER', permissions: [], mustChangePassword: false }
    await auth.loadMe()
    expect(auth.user.value).toBeNull()
  })

  it('login navigates to /change-password when mustChangePassword is true', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/auth/login') return Promise.resolve({ ok: true, mustChangePassword: true })
      return Promise.resolve({ id: 1, username: 'admin', role: 'ADMIN', permissions: [], mustChangePassword: true })
    })
    await useAuth().login('admin', 'admin')
    expect(navigateToMock).toHaveBeenCalledWith('/change-password')
  })

  it('login navigates to / when mustChangePassword is false', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/auth/login') return Promise.resolve({ ok: true, mustChangePassword: false })
      return Promise.resolve({ id: 1, username: 'admin', role: 'ADMIN', permissions: [], mustChangePassword: false })
    })
    await useAuth().login('admin', 'goodpass')
    expect(navigateToMock).toHaveBeenCalledWith('/')
  })

  it('logout clears the user and navigates to /login', async () => {
    fetchMock.mockResolvedValue({ ok: true })
    const auth = useAuth()
    auth.user.value = { id: 1, username: 'x', email: 'x@test.local', role: 'VIEWER', permissions: [], mustChangePassword: false }
    await auth.logout()
    expect(auth.user.value).toBeNull()
    expect(navigateToMock).toHaveBeenCalledWith('/login')
  })
})
