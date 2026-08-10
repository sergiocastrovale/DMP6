// Pure/security-critical logic extracted from server/api/terminal/run.post.ts: command allow-listing,
// session-name validation, permission lookup, shell arg escaping, and the wrapper script/output
// parsing. Kept dependency-free (no h3/child_process/fs) so the injection-sensitive bits - especially
// escapeArg - are directly unit-testable.
import type { PermissionKey } from './permissions'

export const ALLOWED_COMMANDS = [
  './index', './sync', './analysis', './nuke',
  './playlists', './audit', './fix', './refresh',
] as const

// 'sync.view' only ever gated read/list endpoints elsewhere; running these scripts (they can mutate or
// delete library data) needs 'sync.run', not a VIEW permission - see docs audit #29.
export const COMMAND_PERM: Record<string, PermissionKey | 'ADMIN'> = {
  './index': 'sync.run',
  './sync': 'sync.run',
  './refresh': 'sync.run',
  './analysis': 'sync.run',
  './playlists': 'sync.run',
  './audit': 'issues.view',
  './fix': 'issues.view',
  './nuke': 'ADMIN',
}

// Flags that delete data or force a destructive rewrite - restricted to ADMIN regardless of whether the
// caller holds 'sync.run', so a MANAGER can trigger normal index/sync runs but not `--delete`/
// `--overwrite` passes. `--prune` belongs here too: it bypasses index's mount-blip ratio guard, so a
// wrong scope deletes rows the guard would otherwise have saved.
const DESTRUCTIVE_FLAGS = ['--delete', '--overwrite', '--overwrite-with-images', '--prune'] as const

export const hasDestructiveFlag = (args: string[]): boolean =>
  args.some(a => (DESTRUCTIVE_FLAGS as readonly string[]).includes(a))

export const SESSION_NAME_RE = /^[a-zA-Z0-9_-]{1,32}$/

// Commands that support the --web flag (structured PROGRESS:{json} output).
export const WEB_MODE_COMMANDS = new Set(['./index', './sync', './refresh'])

export const isAllowedCommand = (command: string): boolean =>
  (ALLOWED_COMMANDS as readonly string[]).includes(command)

export const isValidSessionName = (session: string | undefined | null): boolean =>
  typeof session === 'string' && SESSION_NAME_RE.test(session)

export const permissionForCommand = (command: string): PermissionKey | 'ADMIN' | undefined =>
  COMMAND_PERM[command]

// Auto-appends --web for commands that support structured progress output, unless already present.
// Rejects a non-array `args` outright rather than silently coercing it.
export const withWebFlag = (command: string, args: unknown): string[] => {
  if (!Array.isArray(args)) {
    throw new TypeError('args must be an array')
  }
  if (WEB_MODE_COMMANDS.has(command) && !args.includes('--web')) {
    return [...args, '--web']
  }
  return [...args]
}

export const stripAnsi = (str: string): string =>
  str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')

// The only injection defense for interpolating a user-controlled arg into a bash command: wraps in
// single quotes, and every single quote in the value is escaped by closing the quote, emitting an
// escaped quote, and reopening it (the standard '\'' technique).
export const escapeArg = (arg: string): string =>
  `'${arg.replace(/'/g, "'\\''")}'`

// The binary path is escaped too. It is not user input (it comes from SCRIPTS_DIR plus an
// allow-listed command name), but an unquoted path breaks the moment SCRIPTS_DIR contains a space.
export const buildCommandLine = (binary: string, args: string[]): string => {
  const safeArgs = args.map(escapeArg).join(' ')
  const safeBinary = escapeArg(binary)
  return safeArgs ? `${safeBinary} ${safeArgs}` : safeBinary
}

// `pipefail` is load-bearing, not tidiness: the command is piped into `tee`, so without it `$?` is
// *tee's* status and a crashed ./sync streamed DMP_EXIT:0 - the UI reported every failed run as clean.
// `set -e` stays off deliberately: the sentinel line must still be written when the command fails,
// which is the whole point of the exit-code channel.
export const buildScript = (workDir: string, fullCmd: string, logFile: string): string => `#!/bin/bash
set -o pipefail
cd "${workDir}"
${fullCmd} 2>&1 | tee "${logFile}"
echo "DMP_EXIT:$?" >> "${logFile}"
`

const EXIT_PREFIX = 'DMP_EXIT:'

// Returns the parsed exit code for a `DMP_EXIT:<code>` sentinel line, or null if the line isn't one.
// A non-numeric code (shouldn't happen - `$?` is always numeric, but garbage output could still land
// here) reports failure (1) rather than silently reading as success - `|| 0` previously turned any
// unparseable value into a false "clean exit" (audit #84).
export const parseExitLine = (line: string): number | null => {
  if (!line.startsWith(EXIT_PREFIX)) {return null}
  const parsed = parseInt(line.slice(EXIT_PREFIX.length), 10)
  return Number.isNaN(parsed) ? 1 : parsed
}

// True when a session's previous log exists but never reached its DMP_EXIT sentinel - i.e. that
// session's command is still running (or crashed without exiting cleanly). Starting a NEW run under
// the same session name would otherwise silently `tmux kill-session` it out from under whoever's
// still watching it (audit #84's multi-tab clobber).
export const hasUnfinishedRun = (prevLogContent: string | null): boolean =>
  prevLogContent !== null && prevLogContent.length > 0 && !prevLogContent.includes(EXIT_PREFIX)
