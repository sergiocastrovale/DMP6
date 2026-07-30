// Pure/security-critical logic extracted from server/api/terminal/run.post.ts: command allow-listing,
// session-name validation, permission lookup, shell arg escaping, and the wrapper script/output
// parsing. Kept dependency-free (no h3/child_process/fs) so the injection-sensitive bits - especially
// escapeArg - are directly unit-testable.
import type { PermissionKey } from './permissions'

export const ALLOWED_COMMANDS = [
  './index', './sync', './analysis', './nuke',
  './playlists', './audit', './fix', './refresh',
] as const

export const COMMAND_PERM: Record<string, PermissionKey | 'ADMIN'> = {
  './index': 'sync.view',
  './sync': 'sync.view',
  './refresh': 'sync.view',
  './analysis': 'sync.view',
  './playlists': 'sync.view',
  './audit': 'issues.view',
  './fix': 'issues.view',
  './nuke': 'ADMIN',
}

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

export const buildCommandLine = (binary: string, args: string[]): string => {
  const safeArgs = args.map(escapeArg).join(' ')
  return safeArgs ? `${binary} ${safeArgs}` : binary
}

export const buildScript = (workDir: string, fullCmd: string, logFile: string): string => `#!/bin/bash
cd "${workDir}"
${fullCmd} 2>&1 | tee "${logFile}"
echo "DMP_EXIT:$?" >> "${logFile}"
`

const EXIT_PREFIX = 'DMP_EXIT:'

// Returns the parsed exit code for a `DMP_EXIT:<code>` sentinel line, or null if the line isn't one.
// A non-numeric code (shouldn't happen - `$?` is always numeric) falls back to 0 rather than NaN.
export const parseExitLine = (line: string): number | null => {
  if (!line.startsWith(EXIT_PREFIX)) return null
  return parseInt(line.slice(EXIT_PREFIX.length), 10) || 0
}
