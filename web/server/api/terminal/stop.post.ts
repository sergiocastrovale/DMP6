import { execSync } from 'child_process'
import { clearScanLock } from '~/server/utils/scanLock'
import { requireTerminalAccess } from '~/server/utils/terminalGuard'
import { readBodyOf } from '~/server/utils/requestValidation'
import { terminalSessionBodySchema } from '~/server/schemas/terminal'

export default defineEventHandler(async (event) => {
  const { session } = await readBodyOf(event, terminalSessionBodySchema)
  await requireTerminalAccess(event, 'stop', session)

  // Lock-holding commands (index/sync/refresh): SIGTERM lets the Rust signal handler release the DB lock and exit
  // cleanly, and the lock is only force-cleared when the holder is verified as one of our own script processes -
  // an unverified lock could let a second run start while a foreign process (another machine/container sharing the
  // DB) still holds it (server/utils/scanLock.ts).
  await clearScanLock({ signalOwn: true, onlyIfOwn: true })

  // For all commands: Ctrl+C to the tmux pane's foreground process group. Session-scoped, always safe regardless of
  // who holds the DB scan lock.
  try {
    execSync(`tmux send-keys -t "${session}" C-c "" 2>/dev/null || true`)
  }
  catch { /* ignore */ }

  return { ok: true }
})
