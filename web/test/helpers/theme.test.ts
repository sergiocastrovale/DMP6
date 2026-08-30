import { describe, expect, it, vi, afterEach } from 'vitest'
import { cssVar } from '../../helpers/theme'

describe('cssVar', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reads a custom property off the document root, trimmed', () => {
    document.documentElement.style.setProperty('--test-token', '  oklch(0.8 0.1 80)  ')
    expect(cssVar('--test-token')).toBe('oklch(0.8 0.1 80)')
  })

  it('returns an empty string for an unset property', () => {
    expect(cssVar('--totally-unset-token')).toBe('')
  })

  it('returns an empty string when document is unavailable (SSR)', () => {
    const original = globalThis.document
    // @ts-expect-error - simulating SSR, no document global
    delete globalThis.document
    expect(cssVar('--color-amber-400')).toBe('')
    globalThis.document = original
  })
})
