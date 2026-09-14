export default defineNuxtRouteMiddleware(() => {
  const { user } = useAuth()
  if (!user.value?.permissions.includes('sync.view')) {
    return navigateTo('/')
  }
})
