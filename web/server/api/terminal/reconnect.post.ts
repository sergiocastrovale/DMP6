import { spawn, execSync } from 'child_process'
import fs from 'fs'
import { parseExitLine, stripAnsi } from '~/server/utils/terminalCommand'

const SESSION_NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const { session } = await readBody<{ session: string }>(event)
  if (!session || !SESSION_NAME_RE.test(session)) {
    throw createError({ statusCode: 400, message: 'Invalid session' })
  }

  // Verify the tmux session still exists
  try {
    execSync(`tmux has-session -t "${session}" 2>/dev/null`)
  }
  catch {
    throw createError({ statusCode: 404, message: 'Session not found' })
  }

  const logFile = `/tmp/dmp-${session}.log`
  if (!fs.existsSync(logFile)) {
    throw createError({ statusCode: 404, message: 'Log file not found' })
  }

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const res = event.node.res

  return new Promise<void>((resolve) => {
    // tail from the beginning (-n +1) to replay existing output, then follow
    const tail = spawn('tail', ['-n', '+1', '-f', logFile])

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
