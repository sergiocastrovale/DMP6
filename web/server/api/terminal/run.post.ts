import { spawn, execSync } from 'child_process'
import fs from 'fs'

const ALLOWED_COMMANDS = [
  './index', './sync', './analysis', './nuke',
  './playlists', './audit', './fix', './refresh',
]

// Commands that support the --web flag (structured PROGRESS:{json} output)
const WEB_MODE_COMMANDS = new Set(['./index', './sync', './refresh'])

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
}

function tmuxAvailable(): boolean {
  try {
    execSync('tmux -V', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    command: string
    args: string[]
    session?: string
  }>(event)
  const { command, session } = body
  let args = body.args ?? []

  if (!ALLOWED_COMMANDS.includes(command)) {
    throw createError({ statusCode: 400, message: `Command not allowed: ${command}` })
  }

  // Binaries are in /usr/local/bin/ (built into container image)
  const binary = command.replace('./', '')
  const workDir = process.env.PROJECT_ROOT || '/app'

  // Web UI always runs scripts in --web mode so the terminal store can
  // consume PROGRESS:{json} lines. Only append if the script supports it
  // and the caller hasn't already passed --web.
  if (WEB_MODE_COMMANDS.has(command) && !args.includes('--web')) {
    args = [...args, '--web']
  }

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const res = event.node.res

  const send = (text: string) => {
    const clean = stripAnsi(text)
    for (const line of clean.split('\n')) {
      if (line) res.write(`data: ${JSON.stringify(line)}\n\n`)
    }
  }

  // Tmux session mode (always used when session is provided)
  if (session) {
    if (!tmuxAvailable()) {
      send('Error: tmux is required but not installed. Install tmux to run commands from the UI.')
      res.write(`event: done\ndata: 1\n\n`)
      res.end()
      return
    }

    const logFile = `/tmp/dmp-${session}.log`
    const scriptFile = `/tmp/dmp-${session}.sh`
    const safeArgs = args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')
    const fullCmd = safeArgs ? `${binary} ${safeArgs}` : binary

    const script = `#!/bin/bash
cd "${workDir}"
${fullCmd} 2>&1 | tee "${logFile}"
echo "DMP_EXIT:$?" >> "${logFile}"
`
    fs.writeFileSync(scriptFile, script, { mode: 0o755 })
    fs.writeFileSync(logFile, '')

    try {
      execSync(`tmux kill-session -t ${session} 2>/dev/null || true`)
      execSync(`tmux new-session -d -s ${session} "${scriptFile}"`)
    } catch (e: any) {
      send(`Failed to start tmux session: ${e.message}`)
      res.write(`event: done\ndata: 1\n\n`)
      res.end()
      return
    }

    return new Promise<void>((resolve) => {
      const tail = spawn('tail', ['-f', logFile])

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
          if (!line) continue
          if (line.startsWith('DMP_EXIT:')) {
            if (!done) {
              done = true
              const code = parseInt(line.slice(9)) || 0
              finish(code)
            }
            return
          }
          res.write(`data: ${JSON.stringify(line)}\n\n`)
        }
      })

      tail.on('error', (err) => {
        if (!done) {
          done = true
          send(`Error: ${err.message}`)
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
  }

  // Direct spawn mode (no session — backward compatible path)
  return new Promise<void>((resolve) => {
    const proc = spawn(binary, args, {
      cwd: workDir,
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb' },
    })

    proc.stdout.on('data', (chunk: Buffer) => send(chunk.toString()))
    proc.stderr.on('data', (chunk: Buffer) => send(chunk.toString()))

    proc.on('close', (code) => {
      res.write(`event: done\ndata: ${code ?? 1}\n\n`)
      res.end()
      resolve()
    })

    proc.on('error', (err) => {
      send(`Error: ${err.message}`)
      res.write(`event: done\ndata: 1\n\n`)
      res.end()
      resolve()
    })

    event.node.req.on('close', () => {
      proc.kill('SIGTERM')
      resolve()
    })
  })
})
