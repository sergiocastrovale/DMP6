import { spawn, execSync } from 'child_process'
import fs from 'fs'
import { requirePermission, requireRole } from '~/server/utils/permissions'
import {
  buildCommandLine,
  buildScript,
  hasDestructiveFlag,
  isAllowedCommand,
  isValidSessionName,
  parseExitLine,
  permissionForCommand,
  stripAnsi,
  withWebFlag,
} from '~/server/utils/terminalCommand'

function tmuxAvailable(): boolean {
  try {
    execSync('tmux -V', { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
}

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    command: string
    args: string[]
    session: string
  }>(event)
  const { command, session } = body

  if (!isAllowedCommand(command)) {
    throw createError({ statusCode: 400, message: `Command not allowed: ${command}` })
  }

  if (!isValidSessionName(session)) {
    throw createError({ statusCode: 400, message: 'Session name required' })
  }

  if (body.args !== undefined && !Array.isArray(body.args)) {
    throw createError({ statusCode: 400, message: 'args must be an array' })
  }

  const perm = permissionForCommand(command)
  if (perm === 'ADMIN') {
    requireRole(event, 'ADMIN')
  }
  else if (perm) {
    await requirePermission(event, perm)
  }

  // Destructive flags (--delete, --overwrite*) bypass the normal 'sync.run' gate - always ADMIN-only,
  // regardless of which permission a MANAGER holds.
  if (hasDestructiveFlag(body.args ?? [])) {
    requireRole(event, 'ADMIN')
  }

  const workDir = process.env.PROJECT_ROOT!
  const scriptsDir = process.env.SCRIPTS_DIR || workDir
  const binaryName = command.replace(/^\.\//, '')
  const binary = `${scriptsDir}/${binaryName}`

  const args = withWebFlag(command, body.args ?? [])

  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  })

  const res = event.node.res

  const send = (text: string) => {
    const clean = stripAnsi(text)
    for (const line of clean.split('\n')) {
      if (line) {res.write(`data: ${JSON.stringify(line)}\n\n`)}
    }
  }

  if (!tmuxAvailable()) {
    send('Error: tmux is required but not installed.')
    res.write(`event: done\ndata: 1\n\n`)
    res.end()
    return
  }

  const logFile = `/tmp/dmp-${session}.log`
  const scriptFile = `/tmp/dmp-${session}.sh`
  const fullCmd = buildCommandLine(binary, args)
  const script = buildScript(workDir, fullCmd, logFile)
  fs.writeFileSync(scriptFile, script, { mode: 0o755 })
  fs.writeFileSync(logFile, '')

  try {
    execSync(`tmux kill-session -t ${session} 2>/dev/null || true`)
    execSync(`tmux new-session -d -s ${session} "${scriptFile}"`)
  }
  catch (e: any) {
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
        send(`Error: ${err.message}`)
        finish(1)
      }
    })

    // SSE disconnect: kill the log tail but leave the tmux session alive.
    // Closing the terminal sidebar or navigating away keeps the process running.
    // Explicit stop goes through /api/terminal/stop which signals the process.
    event.node.req.on('close', () => {
      if (!done) {
        done = true
        tail.kill('SIGTERM')
        resolve()
      }
    })
  })
})
