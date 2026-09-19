import { useTerminalStore } from '~/stores/terminal'
import { ORPHAN_POLL_MS } from '~/helpers/constants'

// App-wide orphan-session recovery: catches a job that's still running server-side but this tab has
// no memory of (a page reload, or the drop happened on a page that was never watching it - any page
// other than Settings → Library before this existed). Mirrors plugins/presence.client.ts's
// auth-gated start/stop pattern. AppShell.vue already mounts TerminalOutput/TerminalProgress
// unconditionally in every layout but auth.vue, so no page-specific wiring is needed here - once the
// store reconnects, the existing UI just reacts.
export default defineNuxtPlugin(() => {
  const terminal = useTerminalStore()
  const { user } = useAuth()

  let pollInterval: ReturnType<typeof setInterval> | null = null

  function start() {
    if (pollInterval) {return}
    terminal.autoReconnectOrphan()
    pollInterval = setInterval(() => {
      if (!terminal.isRunning) {terminal.autoReconnectOrphan()}
    }, ORPHAN_POLL_MS)
  }

  function stop() {
    if (pollInterval) {
      clearInterval(pollInterval)
      pollInterval = null
    }
  }

  watch(() => !!user.value, (loggedIn) => {
    if (loggedIn) {start()}
    else {stop()}
  }, { immediate: true })
})
