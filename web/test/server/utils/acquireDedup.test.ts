import { describe, expect, it } from 'vitest'
import { resolveReplaceTarget } from '../../../server/utils/acquireDedup'

describe('resolveReplaceTarget', () => {
  it('stamps an in-flight row that has no replace target yet', () => {
    expect(resolveReplaceTarget(null, 'lrA')).toEqual({ stamp: true, otherCopyInFlight: false })
  })

  it('never overwrites a row already committed to a different copy', () => {
    // The field decides which folder the merge deletes: overwriting it here destroyed a copy the
    // user never pointed at (two LocalReleases can share one release group).
    expect(resolveReplaceTarget('lrA', 'lrB')).toEqual({ stamp: false, otherCopyInFlight: true })
  })

  it('is a no-op when the row already names the same copy', () => {
    expect(resolveReplaceTarget('lrA', 'lrA')).toEqual({ stamp: false, otherCopyInFlight: false })
  })

  it('does nothing for a plain gap download, which replaces no local copy', () => {
    expect(resolveReplaceTarget('lrA', undefined)).toEqual({ stamp: false, otherCopyInFlight: false })
    expect(resolveReplaceTarget(null, null)).toEqual({ stamp: false, otherCopyInFlight: false })
  })
})
