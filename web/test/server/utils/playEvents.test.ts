import { describe, expect, it } from 'vitest'
import { applyProgress } from '../../../server/utils/playEvents'

describe('applyProgress', () => {
  it('listenedSeconds only ever grows - an out-of-order/lower patch is ignored', () => {
    const prev = { listenedSeconds: 120, counted: false }
    expect(applyProgress(prev, { listenedSeconds: 90 }).listenedSeconds).toBe(120)
    expect(applyProgress(prev, { listenedSeconds: 150 }).listenedSeconds).toBe(150)
  })

  it('defaults listenedSeconds to the previous value when the patch omits it', () => {
    const prev = { listenedSeconds: 45, counted: false }
    expect(applyProgress(prev, {}).listenedSeconds).toBe(45)
  })

  it('counted only ever flips false to true, never back', () => {
    expect(applyProgress({ listenedSeconds: 0, counted: false }, { counted: true }).counted).toBe(true)
    expect(applyProgress({ listenedSeconds: 0, counted: true }, {}).counted).toBe(true)
    expect(applyProgress({ listenedSeconds: 0, counted: true }, { counted: false }).counted).toBe(true)
  })
})
