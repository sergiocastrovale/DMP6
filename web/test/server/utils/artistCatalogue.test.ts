import { describe, expect, it } from 'vitest'
import { pageCatalogue } from '../../../server/utils/artistCatalogue'
import type { UnifiedRelease } from '../../../types/release'

const cards = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` })) as unknown as UnifiedRelease[]

describe('pageCatalogue', () => {
  it('returns every card as a single page when all is set, however many there are', () => {
    const result = pageCatalogue(cards(5848), { page: 3, pageSize: 20, all: true })
    expect(result.releases).toHaveLength(5848)
    expect(result).toMatchObject({ total: 5848, page: 1, pageSize: 5848, hasMore: false })
  })

  it('slices explicit pages and reports hasMore', () => {
    const first = pageCatalogue(cards(45), { page: 1, pageSize: 20, all: false })
    const last = pageCatalogue(cards(45), { page: 3, pageSize: 20, all: false })
    expect(first.releases.map(r => r.id)).toEqual(Array.from({ length: 20 }, (_, i) => `r${i}`))
    expect(first.hasMore).toBe(true)
    expect(last.releases).toHaveLength(5)
    expect(last.hasMore).toBe(false)
  })

  it('an empty catalogue is one empty page', () => {
    expect(pageCatalogue([], { page: 1, pageSize: 20, all: true })).toEqual({ releases: [], total: 0, page: 1, pageSize: 0, hasMore: false })
  })
})
