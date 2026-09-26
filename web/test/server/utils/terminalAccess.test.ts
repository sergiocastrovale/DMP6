import { describe, expect, it } from 'vitest'
import { gateForTerminalAction, parseTerminalRunMeta } from '../../../server/utils/terminalAccess'

describe('gateForTerminalAction', () => {
  it('unlock needs terminal.control (ADMIN-only by default)', () => {
    expect(gateForTerminalAction('unlock', null)).toEqual({ kind: 'permission', key: 'terminal.control' })
  })

  it('viewing sessions or reconnecting needs sync.view', () => {
    expect(gateForTerminalAction('view', null)).toEqual({ kind: 'permission', key: 'sync.view' })
  })

  it('stop with no recorded run falls back to sync.run', () => {
    expect(gateForTerminalAction('stop', null)).toEqual({ kind: 'permission', key: 'sync.run' })
  })

  it('stopping a normal sync run needs sync.run', () => {
    expect(gateForTerminalAction('stop', { command: './sync', args: ['--only', 'X'] })).toEqual({ kind: 'permission', key: 'sync.run' })
  })

  it('stopping a run of a command with its own permission needs that permission', () => {
    expect(gateForTerminalAction('stop', { command: './audit', args: [] })).toEqual({ kind: 'permission', key: 'issues.view' })
  })

  it('stopping an ADMIN-only command needs ADMIN', () => {
    expect(gateForTerminalAction('stop', { command: './nuke', args: [] })).toEqual({ kind: 'role', role: 'ADMIN' })
    expect(gateForTerminalAction('stop', { command: './delete', args: ['A'] })).toEqual({ kind: 'role', role: 'ADMIN' })
  })

  it('stopping a run with a destructive flag needs ADMIN', () => {
    expect(gateForTerminalAction('stop', { command: './index', args: ['--overwrite-with-images'] })).toEqual({ kind: 'role', role: 'ADMIN' })
    expect(gateForTerminalAction('stop', { command: './index', args: ['--prune'] })).toEqual({ kind: 'role', role: 'ADMIN' })
  })
})

describe('parseTerminalRunMeta', () => {
  it('parses a valid sidecar', () => {
    expect(parseTerminalRunMeta('{"command":"./sync","args":["--verbose"]}')).toEqual({ command: './sync', args: ['--verbose'] })
  })

  it('returns null for missing, corrupt or malformed metadata', () => {
    expect(parseTerminalRunMeta(null)).toBeNull()
    expect(parseTerminalRunMeta('not json')).toBeNull()
    expect(parseTerminalRunMeta('{"command":1,"args":[]}')).toBeNull()
    expect(parseTerminalRunMeta('{"command":"./sync"}')).toBeNull()
  })
})
