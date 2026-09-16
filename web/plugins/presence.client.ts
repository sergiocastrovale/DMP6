import { createPresenceHeartbeat, type PresenceTrackInfo } from '~/composables/usePresenceHeartbeat'

// Wires the presence heartbeat (Settings → Users "connected now" panel) to auth state, route, and
// the player store. Skips /login and /change-password - the same pages the auth middleware itself
// treats as pre-session (server/middleware/auth.ts).
const SKIP_PATHS = new Set(['/login', '/change-password'])

export default defineNuxtPlugin(() => {
  const heartbeat = createPresenceHeartbeat()
  const { user } = useAuth()
  const player = usePlayerStore()
  const route = useRoute()

  const currentTrack = (): PresenceTrackInfo | null =>
    player.currentTrack ? { trackId: player.currentTrack.id, playing: player.isPlaying } : null

  const active = computed(() => !!user.value && !SKIP_PATHS.has(route.path))

  watch(active, (isActive) => {
    if (isActive) {
      heartbeat.start(currentTrack)
    }
    else {
      heartbeat.stop()
    }
  }, { immediate: true })

  watch(() => [player.currentTrack?.id, player.isPlaying], () => {
    if (active.value) {heartbeat.notify(currentTrack())}
  })

  window.addEventListener('pagehide', () => heartbeat.leave())
})
