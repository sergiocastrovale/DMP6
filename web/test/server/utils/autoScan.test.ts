import { afterEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('~/server/utils/prisma', () => ({
  prisma: { settings: { findUnique: prismaMocks.findUnique, update: prismaMocks.update } },
}))

vi.mock('~/server/utils/scriptLock', () => ({ runExclusive: (fn: () => Promise<unknown>) => fn() }))
vi.mock('~/server/utils/monitorLog', () => ({ monitorLog: vi.fn() }))

const execFileMock = vi.fn()
vi.mock('node:child_process', () => {
  const execFile = (...args: unknown[]) => execFileMock(...args)
  return { execFile, default: { execFile } }
})

const {
  MIN_AUTO_SCAN_INTERVAL_HOURS, shouldRunAutoScan, resolveAutoScanSettings, runAutoScan,
} = await import('../../../server/utils/autoScan')

afterEach(() => vi.clearAllMocks())

const hoursAgo = (h: number, from: Date) => new Date(from.getTime() - h * 60 * 60_000)

describe('shouldRunAutoScan', () => {
  const now = new Date('2026-08-11T12:00:00Z')

  it('never runs while the toggle is off, however long it has been', () => {
    expect(shouldRunAutoScan({ enabled: false, intervalHours: 12, lastRunAt: null }, now)).toBe(false)
    expect(shouldRunAutoScan({ enabled: false, intervalHours: 12, lastRunAt: hoursAgo(99, now) }, now)).toBe(false)
  })

  it('runs immediately when it has never run', () => {
    expect(shouldRunAutoScan({ enabled: true, intervalHours: 12, lastRunAt: null }, now)).toBe(true)
  })

  it('waits until a full interval has elapsed', () => {
    expect(shouldRunAutoScan({ enabled: true, intervalHours: 12, lastRunAt: hoursAgo(11, now) }, now)).toBe(false)
    expect(shouldRunAutoScan({ enabled: true, intervalHours: 12, lastRunAt: hoursAgo(12, now) }, now)).toBe(true)
    expect(shouldRunAutoScan({ enabled: true, intervalHours: 12, lastRunAt: hoursAgo(13, now) }, now)).toBe(true)
  })

  it('floors the interval so a 0/negative setting cannot scan on every tick', () => {
    const justRan = { enabled: true, intervalHours: 0, lastRunAt: hoursAgo(MIN_AUTO_SCAN_INTERVAL_HOURS / 2, now) }
    expect(shouldRunAutoScan(justRan, now)).toBe(false)
    expect(shouldRunAutoScan({ ...justRan, lastRunAt: hoursAgo(MIN_AUTO_SCAN_INTERVAL_HOURS, now) }, now)).toBe(true)
  })

  it('does not fire on a timestamp in the future (clock jumped backwards)', () => {
    const future = new Date(now.getTime() + 60 * 60_000)
    expect(shouldRunAutoScan({ enabled: true, intervalHours: 12, lastRunAt: future }, now)).toBe(false)
  })
})

describe('resolveAutoScanSettings', () => {
  it('reads DB values when present', async () => {
    prismaMocks.findUnique.mockResolvedValue({ autoScanEnabled: true, autoScanIntervalHours: 6, autoScanLastRunAt: new Date('2026-01-01') })

    const settings = await resolveAutoScanSettings()

    expect(settings).toEqual({ enabled: true, intervalHours: 6, lastRunAt: new Date('2026-01-01') })
  })

  it('floors a below-minimum DB interval', async () => {
    prismaMocks.findUnique.mockResolvedValue({ autoScanEnabled: true, autoScanIntervalHours: 0, autoScanLastRunAt: null })

    const settings = await resolveAutoScanSettings()

    expect(settings.intervalHours).toBe(MIN_AUTO_SCAN_INTERVAL_HOURS)
  })

  it('falls back to env/defaults when there is no settings row', async () => {
    prismaMocks.findUnique.mockResolvedValue(null)

    const settings = await resolveAutoScanSettings()

    expect(settings).toEqual({ enabled: false, intervalHours: 12, lastRunAt: null })
  })
})

describe('runAutoScan', () => {
  const withCb = (result: [Error | null, string, string]) => (...args: unknown[]) => {
    const cb = args[args.length - 1] as (e: Error | null, o: string, err: string) => void
    cb(...result)
  }

  it('runs index then sync, in order, and stamps lastRunAt', async () => {
    const calls: string[] = []
    execFileMock.mockImplementation((...args: unknown[]) => {
      calls.push(String(args[0]))
      withCb([null, 'done', ''])(...args)
    })

    await runAutoScan()

    expect(calls[0]).toContain('/index')
    expect(calls[1]).toContain('/sync')
    expect(prismaMocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'main' } }))
  })

  it('still stamps lastRunAt when a script fails', async () => {
    execFileMock.mockImplementation(withCb([new Error('index crashed'), '', '']))

    await runAutoScan()

    expect(prismaMocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'main' } }))
  })
})
