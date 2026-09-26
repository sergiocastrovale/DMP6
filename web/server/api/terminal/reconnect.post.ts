import { openSse, streamLogAsSse } from '~/server/utils/sse'
import { readBodyOf } from '~/server/utils/requestValidation'
import { terminalSessionBodySchema } from '~/server/schemas/terminal'
import { requireTerminalAccess } from '~/server/utils/terminalGuard'
import { readLogTail, tmuxSessionAlive } from '~/server/utils/tmuxSessions'
import { terminalLogPath } from '~/server/utils/terminalPaths'
import { TERMINAL_LINES_CAP } from '~/helpers/constants'

export default defineEventHandler(async (event) => {
  await requireTerminalAccess(event, 'view')

  const { session } = await readBodyOf(event, terminalSessionBodySchema)

  // Verify the tmux session still exists
  if (!(await tmuxSessionAlive(session))) {
    throw createError({ statusCode: 404, message: 'Session not found' })
  }

  const logFile = terminalLogPath(session)
  if (!(await readLogTail(logFile, 0))) {
    throw createError({ statusCode: 404, message: 'Log file not found' })
  }

  // Replay only the last TERMINAL_LINES_CAP lines - the client keeps no more than that anyway, and replaying the whole
  // file re-sent tens of MB for a long ./index on every reconnect - then follow.
  return streamLogAsSse(openSse(event), logFile, { replayLines: TERMINAL_LINES_CAP })
})
