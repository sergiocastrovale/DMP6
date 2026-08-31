import type { MeResponse } from '~/types/auth'
import type { Role } from '@prisma/client'

export const useAuth = () => {
  const user = useState<MeResponse | null>('auth:user', () => null)

  const isLoggedIn = computed(() => !!user.value)
  const isAdmin = computed(() => user.value?.role === 'ADMIN')
  const isManager = computed(() => user.value?.role === 'MANAGER')

  const hasPerm = (key: string) => computed(() => user.value?.permissions.includes(key) ?? false)

  const loadMe = async () => {
    try {
      user.value = await $fetch<MeResponse>('/api/auth/me', {
        headers: import.meta.server ? useRequestHeaders(['cookie']) : undefined,
      })
    } catch {
      user.value = null
    }
  }

  const login = async (username: string, password: string, rememberMe = true) => {
    const res = await $fetch<{ ok: boolean; mustChangePassword: boolean }>('/api/auth/login', {
      method: 'POST',
      body: { username, password, rememberMe },
    })
    await loadMe()
    if (res.mustChangePassword) {
      await navigateTo('/change-password')
    } else {
      await navigateTo('/')
    }
  }

  const logout = async () => {
    await $fetch('/api/auth/logout', { method: 'POST' })
    user.value = null
    await navigateTo('/login')
  }

  return { user, isLoggedIn, isAdmin, isManager, hasPerm, loadMe, login, logout }
}
