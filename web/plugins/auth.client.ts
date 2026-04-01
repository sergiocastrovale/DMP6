// If Nitro served a non-login page, the session was already verified server-side.
// Set isLoggedIn so client-side route guards work without an extra API call.
export default defineNuxtPlugin(() => {
  const { isLoggedIn } = useAuth()
  const route = useRoute()
  if (route.path !== '/login') {
    isLoggedIn.value = true
  }
})
