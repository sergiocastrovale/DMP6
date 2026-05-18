export default defineNuxtPlugin(async () => {
  const route = useRoute()
  if (route.path === '/login') return

  const { loadMe } = useAuth()
  await loadMe()
})
