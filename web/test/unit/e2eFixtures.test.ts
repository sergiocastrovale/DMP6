import { describe, expect, it } from 'vitest'
import { createReadyGuard, onlyId } from '../../e2e/helpers/fixtures'

describe('e2e/helpers/fixtures onlyId', () => {
  it('matches only the given id when one is provided', () => {
    expect(onlyId('abc123')).toEqual({ id: { in: ['abc123'] } })
  })

  // The actual incident: an unassigned fixture id reaching a Prisma `where` filter. A bare
  // `{ id: undefined }` is silently dropped by Prisma and matches every row - `onlyId` must
  // never produce that shape for any falsy input.
  it('produces an empty, always-safe filter for undefined, null, or an empty string', () => {
    expect(onlyId(undefined)).toEqual({ id: { in: [] } })
    expect(onlyId(null)).toEqual({ id: { in: [] } })
    expect(onlyId('')).toEqual({ id: { in: [] } })
  })
})

describe('e2e/helpers/fixtures createReadyGuard', () => {
  it('starts not-ready and flips only after markReady is called', () => {
    const guard = createReadyGuard()
    expect(guard.isReady()).toBe(false)
    guard.markReady()
    expect(guard.isReady()).toBe(true)
  })

  it('keeps state independent per guard instance (per spec file)', () => {
    const a = createReadyGuard()
    const b = createReadyGuard()
    a.markReady()
    expect(a.isReady()).toBe(true)
    expect(b.isReady()).toBe(false)
  })
})
