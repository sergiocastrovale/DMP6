import { describe, expect, it } from 'vitest'
import {
  buildCommandLine,
  buildScript,
  escapeArg,
  hasDestructiveFlag,
  isAllowedCommand,
  isValidSessionName,
  parseExitLine,
  permissionForCommand,
  stripAnsi,
  withWebFlag,
} from '../../../server/utils/terminalCommand'

describe('isAllowedCommand', () => {
  it('accepts every allow-listed command', () => {
    for (const cmd of ['./index', './sync', './analysis', './nuke', './playlists', './audit', './fix', './refresh']) {
      expect(isAllowedCommand(cmd)).toBe(true)
    }
  })

  it('rejects anything not on the allow-list', () => {
    expect(isAllowedCommand('./rm')).toBe(false)
    expect(isAllowedCommand('rm -rf /')).toBe(false)
    expect(isAllowedCommand('index')).toBe(false)
    expect(isAllowedCommand('')).toBe(false)
  })
})

describe('isValidSessionName', () => {
  it('accepts alphanumeric/underscore/hyphen up to 32 chars', () => {
    expect(isValidSessionName('dmp-sync_1')).toBe(true)
    expect(isValidSessionName('a'.repeat(32))).toBe(true)
  })

  it('rejects empty, too-long, and special characters', () => {
    expect(isValidSessionName('')).toBe(false)
    expect(isValidSessionName('a'.repeat(33))).toBe(false)
    expect(isValidSessionName('has space')).toBe(false)
    expect(isValidSessionName('has;semicolon')).toBe(false)
    expect(isValidSessionName('has$(cmd)')).toBe(false)
    expect(isValidSessionName(undefined)).toBe(false)
    expect(isValidSessionName(null)).toBe(false)
  })
})

describe('permissionForCommand', () => {
  it('maps ./nuke to the ADMIN role gate', () => {
    expect(permissionForCommand('./nuke')).toBe('ADMIN')
  })

  it('maps sync-family commands to sync.run, not the sync.view VIEW permission (docs audit #29)', () => {
    expect(permissionForCommand('./index')).toBe('sync.run')
    expect(permissionForCommand('./sync')).toBe('sync.run')
    expect(permissionForCommand('./refresh')).toBe('sync.run')
    expect(permissionForCommand('./analysis')).toBe('sync.run')
    expect(permissionForCommand('./playlists')).toBe('sync.run')
  })

  it('maps audit/fix to issues.view', () => {
    expect(permissionForCommand('./audit')).toBe('issues.view')
    expect(permissionForCommand('./fix')).toBe('issues.view')
  })

  it('returns undefined for an unknown command', () => {
    expect(permissionForCommand('./unknown')).toBeUndefined()
  })
})

describe('hasDestructiveFlag', () => {
  it('flags --delete, --overwrite, and --overwrite-with-images', () => {
    expect(hasDestructiveFlag(['--delete'])).toBe(true)
    expect(hasDestructiveFlag(['--only', 'X', '--overwrite'])).toBe(true)
    expect(hasDestructiveFlag(['--overwrite-with-images'])).toBe(true)
  })

  it('is false for normal args with no destructive flag', () => {
    expect(hasDestructiveFlag(['--only', 'Boards of Canada'])).toBe(false)
    expect(hasDestructiveFlag([])).toBe(false)
  })

  it('does not false-positive on a flag that merely contains the substring', () => {
    expect(hasDestructiveFlag(['--overwrite-something-else'])).toBe(false)
  })
})

describe('withWebFlag', () => {
  it('appends --web for web-mode commands', () => {
    expect(withWebFlag('./sync', ['--only', 'Artist'])).toEqual(['--only', 'Artist', '--web'])
  })

  it('does not duplicate --web if already present', () => {
    expect(withWebFlag('./sync', ['--web'])).toEqual(['--web'])
  })

  it('leaves args untouched for non-web-mode commands', () => {
    expect(withWebFlag('./nuke', ['--only', 'Artist'])).toEqual(['--only', 'Artist'])
  })

  it('rejects a non-array args value instead of silently coercing it', () => {
    expect(() => withWebFlag('./sync', { '--web': true })).toThrow(TypeError)
    expect(() => withWebFlag('./sync', 'not-an-array')).toThrow(TypeError)
    expect(() => withWebFlag('./sync', null)).toThrow(TypeError)
  })

  it('does not mutate the input array', () => {
    const input = ['--only', 'X']
    withWebFlag('./sync', input)
    expect(input).toEqual(['--only', 'X'])
  })
})

describe('stripAnsi', () => {
  it('removes ANSI escape sequences', () => {
    expect(stripAnsi('\x1B[31mred\x1B[0m text')).toBe('red text')
  })

  it('leaves plain text untouched', () => {
    expect(stripAnsi('plain text')).toBe('plain text')
  })
})

describe('escapeArg - injection safety (security-critical)', () => {
  it('wraps a plain arg in single quotes', () => {
    expect(escapeArg('Artist Name')).toBe(`'Artist Name'`)
  })

  it('escapes an embedded single quote using the close-escape-reopen technique', () => {
    expect(escapeArg("O'Brien")).toBe(`'O'\\''Brien'`)
  })

  it('neutralizes command substitution $(...) - stays inside single quotes, never expands', () => {
    const evil = '$(rm -rf /)'
    const result = escapeArg(evil)
    // Entirely wrapped in single quotes with no unescaped quote boundary -> shell treats it literally.
    expect(result).toBe(`'$(rm -rf /)'`)
    expect(result.startsWith("'")).toBe(true)
    expect(result.endsWith("'")).toBe(true)
  })

  it('neutralizes backticks', () => {
    expect(escapeArg('`whoami`')).toBe('\'`whoami`\'')
  })

  it('neutralizes a quote-breakout attempt combined with a semicolon', () => {
    // Attacker input: '; rm -rf / #
    const evil = "'; rm -rf / #"
    const result = escapeArg(evil)
    // Every single quote in the source is escaped - no raw ' survives to close the wrapping quote early.
    const innerQuotes = result.slice(1, -1).match(/(?<!\\')'(?!\\')/g)
    expect(result).toBe(`''\\''; rm -rf / #'`)
    void innerQuotes
  })

  it('handles newlines and null-byte-like sequences without breaking the quoting', () => {
    const evil = 'line1\nline2\x00tail'
    const result = escapeArg(evil)
    expect(result.startsWith("'")).toBe(true)
    expect(result.endsWith("'")).toBe(true)
    expect(result).toContain('line1\nline2')
  })

  it('handles an empty string', () => {
    expect(escapeArg('')).toBe(`''`)
  })
})

describe('buildCommandLine', () => {
  it('joins the binary with escaped args', () => {
    expect(buildCommandLine('/bin/index', ['--only', 'Boards of Canada'])).toBe(`/bin/index '--only' 'Boards of Canada'`)
  })

  it('returns just the binary when there are no args', () => {
    expect(buildCommandLine('/bin/nuke', [])).toBe('/bin/nuke')
  })
})

describe('buildScript', () => {
  it('produces a bash script that cds into workDir and tees to the log file', () => {
    const script = buildScript('/srv/dmp', '/bin/sync --web', '/tmp/dmp-x.log')
    expect(script).toContain('#!/bin/bash')
    expect(script).toContain('cd "/srv/dmp"')
    expect(script).toContain('/bin/sync --web 2>&1 | tee "/tmp/dmp-x.log"')
    expect(script).toContain('echo "DMP_EXIT:$?" >> "/tmp/dmp-x.log"')
  })
})

describe('parseExitLine', () => {
  it('parses the DMP_EXIT sentinel', () => {
    expect(parseExitLine('DMP_EXIT:0')).toBe(0)
    expect(parseExitLine('DMP_EXIT:1')).toBe(1)
    expect(parseExitLine('DMP_EXIT:130')).toBe(130)
  })

  it('returns null for a non-sentinel line', () => {
    expect(parseExitLine('regular output')).toBeNull()
  })

  it('falls back to 0 for a malformed (non-numeric) code', () => {
    expect(parseExitLine('DMP_EXIT:abc')).toBe(0)
  })
})
