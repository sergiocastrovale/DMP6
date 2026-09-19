import { prisma } from '~/server/utils/prisma'
import { findReconnectableSessions, killTmuxSession } from '~/server/utils/tmuxSessions'

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  await prisma.statistics.update({
    where: { id: 'main' },
    data: {
      scanLockedBy: null,
      scanLockedAt: null,
      scanPid: null,
      updatedAt: new Date(),
    },
  })

  // Clearing the DB row alone leaves the tmux session(s) that were actually blocking things alive -
  // the very next /api/terminal/run with the same session name 409s right back, defeating the whole
  // point of Force Unlock. Kill every live reconnectable session, not just a guessed single name.
  for (const s of findReconnectableSessions()) {
    killTmuxSession(s.session)
  }

  return { ok: true }
})
