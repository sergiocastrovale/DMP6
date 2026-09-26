import { findReconnectableSessions } from '~/server/utils/tmuxSessions'
import { requireTerminalAccess } from '~/server/utils/terminalGuard'

// Lists every live, reconnectable DMP tmux session - the real source of truth for orphan recovery
// (stores/terminal.ts's autoReconnectOrphan()), since Statistics.scanLockedBy only ever names the
// currently-executing binary, not the tmux session the web server actually started (wrong for every
// per-artist action and wrapper script like ./refresh). Usually 0 or 1 entries; more than one is
// possible if multiple scoped actions ran concurrently.
export default defineEventHandler(async (event) => {
  await requireTerminalAccess(event, 'view')

  return { sessions: await findReconnectableSessions() }
})
