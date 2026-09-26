import { describe, expect, it } from 'vitest'
import { clamp } from '../../../../server/utils/subsonic/util'

describe('clamp', () => {
  it('clamps into [min, max]', () => {
    expect(clamp(5, 1, 10)).toBe(5)
    expect(clamp(-5, 1, 10)).toBe(1)
    expect(clamp(50, 1, 10)).toBe(10)
  })
})
