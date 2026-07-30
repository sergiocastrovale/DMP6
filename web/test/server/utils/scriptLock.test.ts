import { describe, expect, it, vi } from 'vitest'
import { runExclusive } from '../../../server/utils/scriptLock'

describe('runExclusive', () => {
  it('serializes concurrent calls in submission order', async () => {
    const order: number[] = []
    const run = (n: number, delay: number) => runExclusive(async () => {
      order.push(n)
      await new Promise(r => setTimeout(r, delay))
      return n
    })

    const [a, b, c] = await Promise.all([run(1, 20), run(2, 5), run(3, 1)])
    expect([a, b, c]).toEqual([1, 2, 3])
    expect(order).toEqual([1, 2, 3])
  })

  it('keeps the chain alive after a rejection so later calls still run', async () => {
    const failing = runExclusive(async () => { throw new Error('boom') })
    await expect(failing).rejects.toThrow('boom')

    const after = vi.fn().mockResolvedValue('ok')
    await expect(runExclusive(after)).resolves.toBe('ok')
    expect(after).toHaveBeenCalledOnce()
  })

  it('returns the resolved value of fn', async () => {
    await expect(runExclusive(async () => 42)).resolves.toBe(42)
  })
})
