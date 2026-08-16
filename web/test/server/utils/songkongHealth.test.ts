import { describe, expect, it } from 'vitest'
import { isDrainerStalled } from '../../../server/utils/songkongHealth'
import { SONGKONG_STALE_AFTER_MIN } from '../../../server/utils/songkongSettings'

// songkong-drain.sh deletes spool/<id> on success, so a spool entry that keeps aging is the one
// unambiguous sign that nothing is consuming the queue — a disabled or misconfigured host cron. That
// is the failure the downloads page could not explain: rows sat in ENRICHING with no visible cause.
describe('isDrainerStalled', () => {
  it('is not stalled when the spool is empty', () => {
    expect(isDrainerStalled(null)).toBe(false)
  })

  it('is not stalled while an entry is still within the turnaround grace', () => {
    expect(isDrainerStalled(SONGKONG_STALE_AFTER_MIN - 1)).toBe(false)
    expect(isDrainerStalled(0)).toBe(false)
  })

  it('is stalled once the oldest entry reaches the staleness window', () => {
    expect(isDrainerStalled(SONGKONG_STALE_AFTER_MIN)).toBe(true)
    expect(isDrainerStalled(60 * 24 * 17)).toBe(true) // the Jul-30 entry that sat until mid-August
  })
})
