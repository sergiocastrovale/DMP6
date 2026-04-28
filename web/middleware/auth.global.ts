export default defineNuxtRouteMiddleware((to) => {
  if (import.meta.server) return
  if (to.path === '/login') return

  const { user } = useAuth()

  if (!user.value) {
    return navigateTo('/login')
  }

  if (user.value.mustChangePassword && to.path !== '/change-password') {
    return navigateTo('/change-password')
  }
})
