import { describe, expect, it, vi, beforeEach } from 'vitest'
import { execFile } from 'node:child_process'
import { open } from 'node:fs/promises'

vi.mock('node:child_process', () => {
  const mocks = { execFile: vi.fn() }
  return { ...mocks, default: mocks }
})
vi.mock('node:fs/promises', () => {
  const mocks = { open: vi.fn() }
  return { ...mocks, default: mocks }
})

const {
  tmuxAvailable,
  tmuxSessionAlive,
  killTmuxSession,
  startTmuxSession,
  listTmuxSessions,
  readLogTail,
  hasUnfinishedLog,
  findReconnectableSessions,
  LOG_TAIL_BYTES,
} = await import('../../../server/utils/tmuxSessions')
const { terminalLogPath } = await import('../../../server/utils/terminalPaths')

type ExecCb = (error: Error | null, stdout?: string) => void

// tmux "succeeds" with `stdout`, or fails.
const tmuxReturns = (stdout: string) => vi.mocked(execFile).mockImplementation(((_c: string, _a: string[], _o: unknown, cb: ExecCb) => cb(null, stdout)) as never)
const tmuxFails = () => vi.mocked(execFile).mockImplementation(((_c: string, _a: string[], _o: unknown, cb: ExecCb) => cb(new Error('tmux: no server running'))) as never)

// A log file of `content` created at `birthtime`; reads honour the (buffer, offset, length, position) contract.
const logFile = (content: string, birthtime = new Date('2026-09-19T18:26:00Z')) => {
  const data = Buffer.from(content)
  const read = vi.fn(async (buffer: Buffer, offset: number, length: number, position: number) => {
    data.copy(buffer, offset, position, position + length)
    return { bytesRead: length }
  })
  const close = vi.fn().mockResolvedValue(undefined)
  return { handle: { stat: async () => ({ size: data.length, birthtime }), read, close }, read, close }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('tmuxAvailable / tmuxSessionAlive', () => {
  it('is true when `tmux -V` succeeds and false when it fails', async () => {
    tmuxReturns('')
    expect(await tmuxAvailable()).toBe(true)
    tmuxFails()
    expect(await tmuxAvailable()).toBe(false)
  })

  it('asks tmux about exactly the named session, without a shell', async () => {
    tmuxReturns('')
    expect(await tmuxSessionAlive('dmp-index')).toBe(true)
    expect(execFile).toHaveBeenCalledWith('tmux', ['has-session', '-t', 'dmp-index'], expect.anything(), expect.any(Function))
    tmuxFails()
    expect(await tmuxSessionAlive('dmp-index')).toBe(false)
  })
})

describe('killTmuxSession / startTmuxSession', () => {
  it('kills by name and never throws when the session is already gone', async () => {
    tmuxReturns('')
    await killTmuxSession('rebuild-al-jolson')
    expect(execFile).toHaveBeenCalledWith('tmux', ['kill-session', '-t', 'rebuild-al-jolson'], expect.anything(), expect.any(Function))
    tmuxFails()
    await expect(killTmuxSession('gone')).resolves.toBeUndefined()
  })

  it('starts a detached session running the script, passing it as one argv element', async () => {
    tmuxReturns('')
    await startTmuxSession('s1', '/tmp/dmp-s1.sh')
    expect(execFile).toHaveBeenCalledWith('tmux', ['new-session', '-d', '-s', 's1', '/tmp/dmp-s1.sh'], expect.anything(), expect.any(Function))
  })
})

describe('listTmuxSessions', () => {
  it('parses newline-separated session names', async () => {
    tmuxReturns('dmp-index\nrebuild-al-jolson\n')
    expect(await listTmuxSessions()).toEqual(['dmp-index', 'rebuild-al-jolson'])
  })

  it('returns [] (not throws) when tmux has no server / no sessions', async () => {
    tmuxFails()
    expect(await listTmuxSessions()).toEqual([])
  })
})

describe('readLogTail', () => {
  it('reads only the last N bytes of a large log, at the right offset', async () => {
    const big = `${'x'.repeat(50_000)}\nlast line\nDMP_EXIT:0\n`
    const file = logFile(big)
    vi.mocked(open).mockResolvedValue(file.handle as never)

    const result = await readLogTail('/tmp/x.log', 64)

    expect(result!.tail).toBe(big.slice(-64))
    expect(file.read).toHaveBeenCalledWith(expect.any(Buffer), 0, 64, big.length - 64)
    expect(file.close).toHaveBeenCalled()
  })

  it('reads the whole file when it is smaller than the window', async () => {
    vi.mocked(open).mockResolvedValue(logFile('short\n').handle as never)
    expect((await readLogTail('/tmp/x.log'))!.tail).toBe('short\n')
  })

  it('an empty file yields an empty tail, and a missing file yields null', async () => {
    vi.mocked(open).mockResolvedValue(logFile('').handle as never)
    expect((await readLogTail('/tmp/x.log'))!.tail).toBe('')
    vi.mocked(open).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    expect(await readLogTail('/tmp/missing.log')).toBeNull()
  })

  it('defaults to a small fixed window - never the whole file', () => {
    expect(LOG_TAIL_BYTES).toBeLessThanOrEqual(4096)
  })
})

describe('hasUnfinishedLog', () => {
  it('is true for a log with output but no sentinel, false once DMP_EXIT is written, false with no log', async () => {
    vi.mocked(open).mockResolvedValue(logFile('Indexing...\n').handle as never)
    expect(await hasUnfinishedLog('s')).toBe(true)
    vi.mocked(open).mockResolvedValue(logFile('Indexing...\nDMP_EXIT:1\n').handle as never)
    expect(await hasUnfinishedLog('s')).toBe(false)
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))
    expect(await hasUnfinishedLog('s')).toBe(false)
  })
})

describe('findReconnectableSessions', () => {
  it('includes a live session whose log has no DMP_EXIT sentinel yet', async () => {
    tmuxReturns('rebuild-al-jolson\n')
    vi.mocked(open).mockResolvedValue(logFile('Indexing...\n').handle as never)

    expect(await findReconnectableSessions()).toEqual([
      { session: 'rebuild-al-jolson', startedAt: '2026-09-19T18:26:00.000Z' },
    ])
    expect(open).toHaveBeenCalledWith(terminalLogPath('rebuild-al-jolson'), 'r')
  })

  // The self-cleaning guarantee: buildScript's EXIT trap already kills its own tmux session once it
  // writes DMP_EXIT, so in practice a finished session wouldn't even show up in listTmuxSessions - but
  // this also covers the residual window before that self-kill lands.
  it('excludes a session whose log already has the DMP_EXIT sentinel', async () => {
    tmuxReturns('dmp-index\n')
    vi.mocked(open).mockResolvedValue(logFile('Indexing...\nDMP_EXIT:0\n').handle as never)

    expect(await findReconnectableSessions()).toEqual([])
  })

  it('excludes a live tmux session with no matching log file', async () => {
    tmuxReturns('some-other-session\n')
    vi.mocked(open).mockRejectedValue(new Error('ENOENT'))

    expect(await findReconnectableSessions()).toEqual([])
  })

  it('excludes a session name that fails SESSION_NAME_RE (defensive - tmux should never report one)', async () => {
    tmuxReturns('not a valid name!\n')

    expect(await findReconnectableSessions()).toEqual([])
    expect(open).not.toHaveBeenCalled()
  })

  it('returns [] when no tmux sessions are live', async () => {
    tmuxFails()

    expect(await findReconnectableSessions()).toEqual([])
  })
})
