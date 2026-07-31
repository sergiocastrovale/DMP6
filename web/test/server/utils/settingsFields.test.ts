import { describe, expect, it } from 'vitest'
import { parseNullableInt } from '../../../server/utils/settingsFields'

describe('parseNullableInt', () => {
  it('undefined (key absent) passes through as undefined - leaves the stored value untouched', () => {
    expect(parseNullableInt(undefined)).toEqual({ ok: true, value: undefined })
  })

  it('null or empty string clears the override', () => {
    expect(parseNullableInt(null)).toEqual({ ok: true, value: null })
    expect(parseNullableInt('')).toEqual({ ok: true, value: null })
  })

  it('preserves a real 0 instead of treating it as falsy (audit #85)', () => {
    expect(parseNullableInt(0)).toEqual({ ok: true, value: 0 })
    expect(parseNullableInt('0')).toEqual({ ok: true, value: 0 })
  })

  it('parses a valid numeric string or number', () => {
    expect(parseNullableInt('42')).toEqual({ ok: true, value: 42 })
    expect(parseNullableInt(42)).toEqual({ ok: true, value: 42 })
  })

  it('rejects non-numeric input instead of letting NaN through to Prisma', () => {
    expect(parseNullableInt('abc')).toEqual({ ok: false })
    expect(parseNullableInt('12abc')).toEqual({ ok: false })
    expect(parseNullableInt(Infinity)).toEqual({ ok: false })
    expect(parseNullableInt({})).toEqual({ ok: false })
  })
})
