import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ findUnique: vi.fn(), update: vi.fn() }))
const tmux = vi.hoisted(() => ({ findReconnectableSessions: vi.fn(), killTmuxSession: vi.fn() }))
const fs = vi.hoisted(() => ({ readFileSync: vi.fn() }))

vi.mock('~/server/utils/prisma', () => ({ prisma: { statistics: { findUnique: db.findUnique, update: db.update } } }))
vi.mock('~/server/utils/tmuxSessions', () => tmux)
vi.mock('node:fs', () => ({ ...fs, default: fs }))

const { clearScanLock } = await import('../../../server/utils/scanLock')

const holder = (pid: number | null, by: string | null) => db.findUnique.mockResolvedValue({ scanPid: pid, scanLockedBy: by })

describe('clearScanLock', () => {
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => true)

  beforeEach(() => {
    vi.clearAllMocks()
    tmux.findReconnectableSessions.mockResolvedValue([{ session: 'a' }, { session: 'b' }])
    fs.readFileSync.mockReturnValue('sync\n')
  })

  it('an admin unlock always clears the row, signals a verified holder and kills the sessions', async () => {
    holder(4242, 'sync')
    const result = await clearScanLock({ signalOwn: true, killSessions: true })
    expect(kill).toHaveBeenCalledWith(4242, 'SIGTERM')
    expect(db.update).toHaveBeenCalledWith({ where: { id: 'main' }, data: expect.objectContaining({ scanLockedBy: null, scanLockedAt: null, scanPid: null }) })
    expect(tmux.killTmuxSession.mock.calls.map(c => c[0])).toEqual(['a', 'b'])
    expect(result).toEqual({ cleared: true, owned: true })
  })

  it('never signals a pid it cannot verify as its own, but still clears for an explicit unlock', async () => {
    holder(4242, 'sync')
    fs.readFileSync.mockReturnValue('bash\n')
    const result = await clearScanLock({ signalOwn: true })
    expect(kill).not.toHaveBeenCalled()
    expect(db.update).toHaveBeenCalled()
    expect(result).toEqual({ cleared: true, owned: false })
  })

  it('signalOwn false clears the lock and leaves the holder running', async () => {
    holder(4242, 'sync')
    await clearScanLock({ signalOwn: false })
    expect(kill).not.toHaveBeenCalled()
    expect(db.update).toHaveBeenCalled()
    expect(tmux.killTmuxSession).not.toHaveBeenCalled()
  })

  it('a stop (onlyIfOwn) leaves a lock held by another machine alone', async () => {
    holder(4242, 'sync')
    fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT') })
    const result = await clearScanLock({ signalOwn: true, onlyIfOwn: true })
    expect(db.update).not.toHaveBeenCalled()
    expect(result).toEqual({ cleared: false, owned: false })
  })

  it('a stop clears the row when the holder is verified as ours', async () => {
    holder(4242, 'sync')
    expect((await clearScanLock({ signalOwn: true, onlyIfOwn: true })).cleared).toBe(true)
    expect(kill).toHaveBeenCalledWith(4242, 'SIGTERM')
  })

  it('no recorded pid: nothing to signal, and an admin unlock still clears', async () => {
    holder(null, null)
    expect(await clearScanLock({ signalOwn: true })).toEqual({ cleared: true, owned: false })
    expect(kill).not.toHaveBeenCalled()
  })

  it('an already-dead pid is not an error', async () => {
    holder(4242, 'sync')
    kill.mockImplementationOnce(() => { throw new Error('ESRCH') })
    await expect(clearScanLock({ signalOwn: true })).resolves.toMatchObject({ cleared: true })
  })
})
