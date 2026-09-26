import { useTerminalStore } from '~/stores/terminal'
import { ORPHAN_POLL_MS } from '~/helpers/constants'
import { createPoller } from '~/helpers/poller'

// App-wide orphan-session recovery: catches a job that's still running server-side but this tab has
// no memory of (a page reload, or the drop happened on a page that was never watching it - any page
// other than Settings → Library before this existed). Mirrors plugins/presence.client.ts's
// auth-gated start/stop pattern. AppShell.vue already mounts TerminalOutput/TerminalProgress
// unconditionally in every layout but auth.vue, so no page-specific wiring is needed here - once the
// store reconnects, the existing UI just reacts.
export default defineNuxtPlugin(() => {
  const terminal = useTerminalStore()
  const { user, hasPerm } = useAuth()
  const canViewSessions = hasPerm('sync.view')

  // Pauses while the tab is hidden, so a background tab isn't listing tmux sessions every 15 s.
  const poller = createPoller({
    run: () => { if (!terminal.isRunning) {return terminal.autoReconnectOrphan()} },
    delay: () => ORPHAN_POLL_MS,
  })

  const start = () => {
    if (poller.active) {return}
    terminal.autoReconnectOrphan()
    poller.start()
  }

  const stop = () => {
    poller.stop()
  }

  // /api/terminal/sessions is gated on sync.view - a VIEWER's tab must not poll it just to collect 403s.
  watch(() => !!user.value && canViewSessions.value, (allowed) => {
    if (allowed) {start()}
    else {stop()}
  }, { immediate: true })
})
