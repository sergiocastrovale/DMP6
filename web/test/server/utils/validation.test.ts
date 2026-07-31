import { describe, expect, it } from 'vitest'
import { isValidEmail } from '../../../server/utils/validation'

describe('isValidEmail', () => {
  it('accepts a plausible email', () => {
    expect(isValidEmail('user@example.com')).toBe(true)
    expect(isValidEmail('first.last+tag@sub.example.co')).toBe(true)
  })

  it('rejects missing @, missing domain dot, or whitespace', () => {
    expect(isValidEmail('not-an-email')).toBe(false)
    expect(isValidEmail('user@nodot')).toBe(false)
    expect(isValidEmail('user @example.com')).toBe(false)
    expect(isValidEmail('')).toBe(false)
  })
})
