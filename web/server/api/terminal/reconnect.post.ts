import { spawn } from 'child_process'
import { parseExitLine, stripAnsi } from '~/server/utils/terminalCommand'
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

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const res = event.node.res

  return new Promise<void>((resolve) => {
    // Replay only the last TERMINAL_LINES_CAP lines - the client keeps no more than that anyway, and `-n +1`
    // re-sent the whole file (tens of MB for a long ./index) on every reconnect - then follow.
    const tail = spawn('tail', ['-n', String(TERMINAL_LINES_CAP), '-f', logFile])

    const finish = (code: number) => {
      tail.kill('SIGTERM')
      res.write(`event: done\ndata: ${code}\n\n`)
      res.end()
      resolve()
    }

    let done = false
    tail.stdout.on('data', (chunk: Buffer) => {
      const text = stripAnsi(chunk.toString())
      for (const line of text.split('\n')) {
        if (!line) {continue}
        const exitCode = parseExitLine(line)
        if (exitCode !== null) {
          if (!done) {
            done = true
            finish(exitCode)
          }
          return
        }
        res.write(`data: ${JSON.stringify(line)}\n\n`)
      }
    })

    tail.on('error', (err) => {
      if (!done) {
        done = true
        res.write(`data: ${JSON.stringify(`Error: ${err.message}`)}\n\n`)
        finish(1)
      }
    })

    event.node.req.on('close', () => {
      if (!done) {
        done = true
        tail.kill('SIGTERM')
        resolve()
      }
    })
  })
})
