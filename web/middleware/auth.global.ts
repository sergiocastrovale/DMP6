// Server-side protection is handled by Nitro (server/middleware/auth.ts).
// This guard covers client-side navigation after the app is loaded.
export default defineNuxtRouteMiddleware((to) => {
  if (import.meta.server) return
  if (to.path === '/login') return

  const { isLoggedIn } = useAuth()
  if (!isLoggedIn.value) {
    return navigateTo('/login')
  }
})
