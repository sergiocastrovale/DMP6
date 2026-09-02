import { afterEach, describe, expect, it, vi } from 'vitest'

const fsMocks = vi.hoisted(() => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 0 }),
  rename: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('node:fs/promises', () => ({ ...fsMocks, default: fsMocks }))

const prismaMocks = vi.hoisted(() => ({ create: vi.fn().mockResolvedValue(undefined) }))
vi.mock('~/server/utils/prisma', () => ({ prisma: { monitorEvent: { create: prismaMocks.create } } }))

const { monitorLog } = await import('../../../server/utils/monitorLog')

const flush = () => new Promise(r => setTimeout(r, 0))

afterEach(() => vi.clearAllMocks())

describe('monitorLog', () => {
  it('writes error-level lines to console.error and warn/notice to console.log', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    monitorLog('error', 'boom')
    monitorLog('notice', 'fyi')

    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[error] boom'))
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[notice] fyi'))
    errSpy.mockRestore()
    logSpy.mockRestore()
  })

  it('appends the line to the log file', async () => {
    monitorLog('warn', 'disk low')
    await flush()

    expect(fsMocks.appendFile).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('disk low'))
  })

  it('rotates the log file once it reaches the size cap', async () => {
    fsMocks.stat.mockResolvedValueOnce({ size: 10 * 1024 * 1024 })

    monitorLog('warn', 'rotate me')
    await flush()

    expect(fsMocks.rename).toHaveBeenCalled()
  })

  it('persists warn/error events to the DB, but not routine notices', async () => {
    monitorLog('warn', 'persist me')
    monitorLog('notice', 'do not persist')
    await flush()

    expect(prismaMocks.create).toHaveBeenCalledTimes(1)
    expect(prismaMocks.create).toHaveBeenCalledWith({ data: { level: 'warn', message: 'persist me' } })
  })

  it('swallows a failed DB persist without throwing', async () => {
    prismaMocks.create.mockRejectedValueOnce(new Error('db down'))

    expect(() => monitorLog('error', 'db is down')).not.toThrow()
    await flush()
  })

  it('swallows a failed log-directory/file write without throwing', async () => {
    fsMocks.mkdir.mockRejectedValueOnce(new Error('EACCES'))
    fsMocks.appendFile.mockRejectedValueOnce(new Error('disk full'))

    expect(() => monitorLog('notice', 'fs trouble')).not.toThrow()
    await flush()
  })
})
