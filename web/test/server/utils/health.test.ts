import { describe, expect, it, vi } from 'vitest'
import { checkHealth } from '../../../server/utils/health'

describe('checkHealth', () => {
  it('is ok when the database answers, with or without Redis', async () => {
    expect(await checkHealth({ pingDatabase: async () => 1 })).toEqual({ ok: true })
    expect(await checkHealth({ pingDatabase: async () => 1, pingRedis: async () => 'PONG' })).toEqual({ ok: true })
  })

  it('is not ok when the database errors', async () => {
    expect(await checkHealth({ pingDatabase: async () => { throw new Error('down') } })).toEqual({ ok: false })
  })

  it('is not ok when the database hangs past the timeout', async () => {
    vi.useFakeTimers()
    const pending = checkHealth({ pingDatabase: () => new Promise(() => {}) }, 1_000)
    await vi.advanceTimersByTimeAsync(1_001)
    expect(await pending).toEqual({ ok: false })
    vi.useRealTimers()
  })

  it('a down or hung Redis never changes the verdict', async () => {
    expect(await checkHealth({ pingDatabase: async () => 1, pingRedis: async () => { throw new Error('nope') } })).toEqual({ ok: true })
    vi.useFakeTimers()
    const pending = checkHealth({ pingDatabase: async () => 1, pingRedis: () => new Promise(() => {}) }, 1_000)
    await vi.advanceTimersByTimeAsync(1_001)
    expect(await pending).toEqual({ ok: true })
    vi.useRealTimers()
  })
})
