import { execSync } from 'child_process'
import { prisma } from '~/server/utils/prisma'

const SESSION_NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const { session } = await readBody<{ session: string }>(event)
  if (!session || !SESSION_NAME_RE.test(session)) {
    throw createError({ statusCode: 400, message: 'Invalid session' })
  }

  // For lock-holding commands (index/sync/refresh): SIGTERM lets the Rust
  // signal handler run, release the DB lock, then exit cleanly.
  try {
    const stats = await prisma.statistics.findUnique({
      where: { id: 'main' },
      select: { scanPid: true, scanLockedBy: true },
    })
    if (stats?.scanPid && stats.scanLockedBy) {
      process.kill(stats.scanPid, 'SIGTERM')
    }
  }
  catch { /* pid already dead - fine */ }

  // For all commands: Ctrl+C to the tmux pane's foreground process group.
  // Also acts as belt-and-suspenders for lock-holding commands.
  try {
    execSync(`tmux send-keys -t "${session}" C-c "" 2>/dev/null || true`)
  }
  catch {}

  // Force-clear the DB lock since the process may not clean up in time
  await prisma.statistics.update({
    where: { id: 'main' },
    data: {
      scanLockedBy: null,
      scanLockedAt: null,
      scanPid: null,
      updatedAt: new Date(),
    },
  })

  return { ok: true }
})
