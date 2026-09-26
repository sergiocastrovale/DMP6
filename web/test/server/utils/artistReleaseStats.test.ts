import { describe, expect, it } from 'vitest'
import { withReleaseCounts } from '../../../server/utils/artistReleaseStats'

describe('withReleaseCounts', () => {
  it('attaches releaseCount onto each item by id', () => {
    const items = [{ id: 'a1', name: 'Artist One' }, { id: 'a2', name: 'Artist Two' }]
    expect(withReleaseCounts(items, new Map([['a1', 3], ['a2', 1]]))).toEqual([
      { id: 'a1', name: 'Artist One', releaseCount: 3 },
      { id: 'a2', name: 'Artist Two', releaseCount: 1 },
    ])
  })

  it('defaults to 0 for an artist with no entry (a manually added artist with no files)', () => {
    expect(withReleaseCounts([{ id: 'ghost' }], new Map())).toEqual([{ id: 'ghost', releaseCount: 0 }])
  })

  it('does not mutate its input', () => {
    const items = [{ id: 'a1' }]
    withReleaseCounts(items, new Map([['a1', 2]]))
    expect(items).toEqual([{ id: 'a1' }])
  })
})
