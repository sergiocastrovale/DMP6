import { requirePermission } from '~/server/utils/permissions'
import { clearScanLock } from '~/server/utils/scanLock'
import { readBodyOf } from '~/server/utils/requestValidation'
import { unlockBodySchema } from '~/server/schemas/terminal'

// Explicit admin override for a lock the UI already reports as stale. The row is always cleared; `signalOwn`
// (default) also stops the holder when it is verifiably one of ours, `signalOwn: false` clears the lock and leaves
// the other script running (the "run alongside it" path in stores/terminal.ts).
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'terminal.control')
  const { signalOwn } = await readBodyOf(event, unlockBodySchema)

  await clearScanLock({ signalOwn, killSessions: true })

  return { ok: true }
})
