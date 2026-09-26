import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~/server/utils/monitorLog', () => ({ monitorLog: vi.fn() }))

const { createWorker, SLOW_WORKER_MS } = await import('../../../server/utils/worker')

describe('createWorker', () => {
  let clock = 0
  const now = () => clock
  const log = vi.fn()

  beforeEach(() => {
    clock = 1_000_000
    log.mockReset()
  })

  it('runs the body and records nothing when all goes well', async () => {
    const run = vi.fn(async () => {})
    await createWorker({ name: 'w', run, log, now }).tick()
    expect(run).toHaveBeenCalledTimes(1)
    expect(log).not.toHaveBeenCalled()
  })

  it('never overlaps: a tick while a run is in flight is skipped', async () => {
    let release: () => void = () => {}
    const run = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const worker = createWorker({ name: 'w', run, log, now })
    const first = worker.tick()
    await vi.waitFor(() => expect(worker.isRunning()).toBe(true))
    await worker.tick()
    expect(run).toHaveBeenCalledTimes(1)
    release()
    await first
    expect(worker.isRunning()).toBe(false)
  })

  it('throttles to minIntervalMs, following a live value', async () => {
    let interval = 60_000
    const run = vi.fn(async () => {})
    const worker = createWorker({ name: 'w', run, minIntervalMs: async () => interval, log, now })
    await worker.tick()
    clock += 59_000
    await worker.tick()
    expect(run).toHaveBeenCalledTimes(1)
    interval = 30_000
    await worker.tick()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('a skipped precondition does not stamp the throttle', async () => {
    let ok = false
    const run = vi.fn(async () => {})
    const worker = createWorker({ name: 'w', run, minIntervalMs: 60_000, shouldRun: () => ok, log, now })
    await worker.tick()
    ok = true
    await worker.tick()
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('a throwing body is logged, not thrown, and releases the guard', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(undefined)
    const worker = createWorker({ name: 'gaps', run, log, now })
    await expect(worker.tick()).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledWith('error', 'gaps failed: boom')
    await worker.tick()
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('warns when a run takes longer than 30s', async () => {
    const worker = createWorker({ name: 'slow', run: async () => { clock += SLOW_WORKER_MS + 5_000 }, log, now })
    await worker.tick()
    expect(log).toHaveBeenCalledWith('warn', 'slow took 35s')
  })

  it('reset makes the next tick unthrottled', async () => {
    const run = vi.fn(async () => {})
    const worker = createWorker({ name: 'w', run, minIntervalMs: 60_000, log, now })
    await worker.tick()
    worker.reset()
    await worker.tick()
    expect(run).toHaveBeenCalledTimes(2)
  })
})
