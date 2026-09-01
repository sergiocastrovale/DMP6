export default defineNuxtPlugin(async () => {
  const route = useRoute()
  if (route.path === '/login') {return}

  const { user, loadMe } = useAuth()
  if (import.meta.client && user.value !== null) {return}

  await loadMe()
})
