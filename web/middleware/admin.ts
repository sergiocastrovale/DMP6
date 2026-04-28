export default defineNuxtRouteMiddleware(() => {
  if (import.meta.server) return

  const { isAdmin } = useAuth()
  if (!isAdmin.value) {
    return navigateTo('/')
  }
})
