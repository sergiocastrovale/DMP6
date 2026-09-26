import fs from 'fs'
import { requirePermission, requireRole } from '~/server/utils/permissions'
import {
  buildCommandLine,
  buildScript,
  hasDestructiveFlag,
  isAllowedCommand,
  permissionForCommand,
  permissionsForFlags,
  withWebFlag,
} from '~/server/utils/terminalCommand'
import { projectRoot, scriptPath } from '~/server/utils/runScript'
import { openSse, streamLogAsSse } from '~/server/utils/sse'
import { readBodyOf } from '~/server/utils/requestValidation'
import { terminalRunBodySchema } from '~/server/schemas/terminal'
import { hasUnfinishedLog, killTmuxSession, startTmuxSession, tmuxAvailable, tmuxSessionAlive } from '~/server/utils/tmuxSessions'
import { ensureTerminalDir, pruneTerminalFiles, terminalLogPath, terminalMetaPath, terminalScriptPath } from '~/server/utils/terminalPaths'

export default defineEventHandler(async (event) => {
  const body = await readBodyOf(event, terminalRunBodySchema)
  const { command, session } = body

  if (!isAllowedCommand(command)) {
    throw createError({ statusCode: 400, message: `Command not allowed: ${command}` })
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

  const workDir = projectRoot()
  const binary = scriptPath(command.replace(/^\.\//, ''))

  const args = withWebFlag(command, body.args ?? [])

  if (!(await tmuxAvailable())) {
    const sse = openSse(event)
    sse.send('Error: tmux is required but not installed.')
    sse.done(1)
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
  await ensureTerminalDir()
  // Old runs' files are pruned opportunistically, off the request's critical path.
  void pruneTerminalFiles()
  fs.writeFileSync(scriptFile, script, { mode: 0o700 })
  fs.writeFileSync(logFile, '', { mode: 0o600 })
  // What `stop` needs to gate on: a MANAGER must not be able to stop an ADMIN-only run.
  fs.writeFileSync(terminalMetaPath(session), JSON.stringify({ command, args: body.args ?? [] }), { mode: 0o600 })

  const sse = openSse(event)

  try {
    await killTmuxSession(session)
    await startTmuxSession(session, scriptFile)
  }
  catch (e: any) {
    sse.send(`Failed to start tmux session: ${e.message}`)
    sse.done(1)
    return
  }

  return streamLogAsSse(sse, logFile)
})
