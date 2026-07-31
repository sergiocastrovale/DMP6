import { execSync } from 'child_process'
import { prisma } from '~/server/utils/prisma'
import { isOwnScanProcess } from '~/server/utils/scanLock'

const SESSION_NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const { session } = await readBody<{ session: string }>(event)
  if (!session || !SESSION_NAME_RE.test(session)) {
    throw createError({ statusCode: 400, message: 'Invalid session' })
  }

  // For lock-holding commands (index/sync/refresh): SIGTERM lets the Rust signal handler run,
  // release the DB lock, then exit cleanly. Only signal/clear the lock when the recorded PID is
  // verified to be one of our own script processes in this namespace - it may belong to a different
  // machine/container sharing the same DB (see server/utils/scanLock.ts).
  const stats = await prisma.statistics.findUnique({
    where: { id: 'main' },
    select: { scanPid: true, scanLockedBy: true },
  })
  const ownsLock = stats?.scanPid != null && isOwnScanProcess(stats.scanPid, stats.scanLockedBy)

  if (ownsLock) {
    try {
      process.kill(stats!.scanPid!, 'SIGTERM')
    }
    catch { /* pid already dead - fine */ }
  }

  // For all commands: Ctrl+C to the tmux pane's foreground process group. Session-scoped, always safe
  // regardless of who holds the DB scan lock.
  try {
    execSync(`tmux send-keys -t "${session}" C-c "" 2>/dev/null || true`)
  }
  catch { /* ignore */ }

  // Only force-clear the DB lock when we've verified we own it - clearing an unverified lock could
  // let a second run start while a foreign process (different machine/container) still holds it.
  if (ownsLock) {
    await prisma.statistics.update({
      where: { id: 'main' },
      data: {
        scanLockedBy: null,
        scanLockedAt: null,
        scanPid: null,
        updatedAt: new Date(),
      },
    })
  }

  return { ok: true }
})
