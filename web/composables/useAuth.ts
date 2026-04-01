export const useAuth = () => {
  const isLoggedIn = useState('auth:logged-in', () => false)

  const login = async (username: string, password: string) => {
    await $fetch('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    })
    isLoggedIn.value = true
    await navigateTo('/')
  }

  const logout = async () => {
    await $fetch('/api/auth/logout', { method: 'POST' })
    isLoggedIn.value = false
    await navigateTo('/login')
  }

  return { isLoggedIn, login, logout }
}
