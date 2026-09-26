import { describe, expect, it, vi } from 'vitest'
import { createSlowQueryLogger, formatSlowQuery } from '../../../server/utils/slowQuery'

describe('formatSlowQuery', () => {
  it('collapses whitespace, truncates to 300 characters and reports the duration', () => {
    const line = formatSlowQuery({ query: `SELECT   *\n  FROM "T" WHERE x = ${'y'.repeat(400)}`, duration: 1234 })
    expect(line.startsWith('slow query 1234ms: SELECT * FROM "T" WHERE x = ')).toBe(true)
    expect(line.length).toBeLessThan(340)
    expect(line.endsWith('…')).toBe(true)
  })

  it('never includes parameters (only the event query text is used)', () => {
    const line = formatSlowQuery({ query: 'SELECT 1 WHERE a = $1', duration: 2000, params: '["secret"]' } as never)
    expect(line).not.toContain('secret')
  })
})

describe('createSlowQueryLogger', () => {
  it('ignores queries under the threshold', () => {
    const sink = vi.fn()
    createSlowQueryLogger(1000, sink)({ query: 'SELECT 1', duration: 999 })
    expect(sink).not.toHaveBeenCalled()
  })

  it('logs one distinct statement at most once per throttle window', () => {
    let t = 0
    const sink = vi.fn()
    const log = createSlowQueryLogger(1000, sink, () => t)
    log({ query: 'SELECT slow', duration: 2000 })
    t = 5_000
    log({ query: 'SELECT slow', duration: 2000 })
    log({ query: 'SELECT other', duration: 2000 })
    expect(sink).toHaveBeenCalledTimes(2)
    t = 11_000
    log({ query: 'SELECT slow', duration: 2000 })
    expect(sink).toHaveBeenCalledTimes(3)
  })

  it('remembers a bounded number of statements', () => {
    let t = 0
    const sink = vi.fn()
    const log = createSlowQueryLogger(1, sink, () => t)
    for (let i = 0; i < 300; i++) {
      log({ query: `SELECT ${i}`, duration: 5 })
    }
    t = 1
    log({ query: 'SELECT 0', duration: 5 }) // long forgotten: logged again despite the throttle window
    expect(sink).toHaveBeenCalledTimes(301)
  })
})
