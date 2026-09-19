import { describe, expect, it, vi, beforeEach } from 'vitest'
import { execSync } from 'child_process'
import fs from 'fs'

vi.mock('child_process', () => {
  const mocks = { execSync: vi.fn() }
  return { ...mocks, default: mocks }
})
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    statSync: vi.fn(),
  },
}))

const {
  tmuxAvailable,
  tmuxSessionAlive,
  killTmuxSession,
  listTmuxSessions,
  findReconnectableSessions,
} = await import('../../../server/utils/tmuxSessions')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('tmuxAvailable', () => {
  it('is true when `tmux -V` succeeds', () => {
    vi.mocked(execSync).mockReturnValue('' as any)
    expect(tmuxAvailable()).toBe(true)
  })

  it('is false when tmux is not installed', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('not found') })
    expect(tmuxAvailable()).toBe(false)
  })
})

describe('tmuxSessionAlive', () => {
  it('is true when `tmux has-session` succeeds', () => {
    vi.mocked(execSync).mockReturnValue('' as any)
    expect(tmuxSessionAlive('dmp-index')).toBe(true)
  })

  it('is false when the session does not exist', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('no session') })
    expect(tmuxSessionAlive('dmp-index')).toBe(false)
  })
})

describe('killTmuxSession', () => {
  it('shells out to tmux kill-session with the given name', () => {
    vi.mocked(execSync).mockReturnValue('' as any)
    killTmuxSession('rebuild-al-jolson')
    expect(execSync).toHaveBeenCalledWith(expect.stringContaining('tmux kill-session -t "rebuild-al-jolson"'))
  })

  it('never throws even if the underlying session is already gone', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('no session') })
    expect(() => killTmuxSession('gone')).not.toThrow()
  })
})

describe('listTmuxSessions', () => {
  it('parses newline-separated session names', () => {
    vi.mocked(execSync).mockReturnValue('dmp-index\nrebuild-al-jolson\n' as any)
    expect(listTmuxSessions()).toEqual(['dmp-index', 'rebuild-al-jolson'])
  })

  it('returns [] (not throws) when tmux has no server / no sessions', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('no server running') })
    expect(listTmuxSessions()).toEqual([])
  })
})

describe('findReconnectableSessions', () => {
  it('includes a live session whose log exists and has no DMP_EXIT sentinel yet', () => {
    vi.mocked(execSync).mockReturnValue('rebuild-al-jolson\n' as any)
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('Indexing...\n' as any)
    vi.mocked(fs.statSync).mockReturnValue({ birthtime: new Date('2026-09-19T18:26:00Z') } as any)

    expect(findReconnectableSessions()).toEqual([
      { session: 'rebuild-al-jolson', startedAt: '2026-09-19T18:26:00.000Z' },
    ])
  })

  // The self-cleaning guarantee: buildScript's EXIT trap already kills its own tmux session once it
  // writes DMP_EXIT, so in practice a finished session wouldn't even show up in listTmuxSessions - but
  // this also covers the residual window before that self-kill lands.
  it('excludes a session whose log already has the DMP_EXIT sentinel', () => {
    vi.mocked(execSync).mockReturnValue('dmp-index\n' as any)
    vi.mocked(fs.existsSync).mockReturnValue(true)
    vi.mocked(fs.readFileSync).mockReturnValue('Indexing...\nDMP_EXIT:0\n' as any)
    vi.mocked(fs.statSync).mockReturnValue({ birthtime: new Date() } as any)

    expect(findReconnectableSessions()).toEqual([])
  })

  it('excludes a live tmux session with no matching log file', () => {
    vi.mocked(execSync).mockReturnValue('some-other-session\n' as any)
    vi.mocked(fs.existsSync).mockReturnValue(false)

    expect(findReconnectableSessions()).toEqual([])
  })

  it('excludes a session name that fails SESSION_NAME_RE (defensive - tmux should never report one)', () => {
    vi.mocked(execSync).mockReturnValue('not a valid name!\n' as any)

    expect(findReconnectableSessions()).toEqual([])
  })

  it('returns [] when no tmux sessions are live', () => {
    vi.mocked(execSync).mockImplementation(() => { throw new Error('no server running') })

    expect(findReconnectableSessions()).toEqual([])
  })
})
