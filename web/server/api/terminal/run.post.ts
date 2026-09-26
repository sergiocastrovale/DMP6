import { spawn } from 'child_process'
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
  permissionsForFlags,
  stripAnsi,
  withWebFlag,
} from '~/server/utils/terminalCommand'
import { hasUnfinishedLog, killTmuxSession, startTmuxSession, tmuxAvailable, tmuxSessionAlive } from '~/server/utils/tmuxSessions'
import { terminalLogPath, terminalScriptPath } from '~/server/utils/terminalPaths'
import { terminalRunMetaPath } from '~/server/utils/terminalAccess'

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

  // Per-flag gates on top of the command's own permission - e.g. `--monitored` on `./add` needs
  // 'downloads.crud', same as the existing monitoring toggle, even though `./add` itself only needs
  // 'sync.run'.
  for (const flagPerm of permissionsForFlags(body.args ?? [])) {
    await requirePermission(event, flagPerm)
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

  if (!(await tmuxAvailable())) {
    send('Error: tmux is required but not installed.')
    res.write(`event: done\ndata: 1\n\n`)
    res.end()
    return
  }

  const logFile = terminalLogPath(session)
  const scriptFile = terminalScriptPath(session)

  // A same-named session still mid-run (no DMP_EXIT sentinel yet) means another tab/user is watching
  // it - don't silently tmux-kill it out from under them (audit #84). Check BEFORE the log gets
  // truncated below.
  // The tmux check is what keeps this from wedging: a run killed without writing its sentinel (an
  // old-format script, an OOM kill, a `tmux kill-server`) left a log that blocked the session name
  // permanently, with no UI route back other than deleting the file by hand.
  if (await hasUnfinishedLog(session) && await tmuxSessionAlive(session)) {
    throw createError({
      statusCode: 409,
      message: `Session "${session}" is already running - stop it first or reconnect instead.`,
    })
  }

  const fullCmd = buildCommandLine(binary, args)
  const script = buildScript(workDir, fullCmd, logFile, session)
  fs.writeFileSync(scriptFile, script, { mode: 0o755 })
  fs.writeFileSync(logFile, '')
  // What `stop` needs to gate on: a MANAGER must not be able to stop an ADMIN-only run.
  fs.writeFileSync(terminalRunMetaPath(session), JSON.stringify({ command, args: body.args ?? [] }))

  try {
    await killTmuxSession(session)
    await startTmuxSession(session, scriptFile)
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
