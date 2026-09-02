import { afterEach, describe, expect, it, vi } from 'vitest'
import { readdir, stat } from 'node:fs/promises'
import { isDrainerStalled, readSongkongHealth } from '../../../server/utils/songkongHealth'
import { SONGKONG_STALE_AFTER_MIN } from '../../../server/utils/songkongSettings'

vi.mock('node:fs/promises', () => {
  const mocks = { readdir: vi.fn(), stat: vi.fn() }
  return { ...mocks, default: mocks }
})
vi.mock('~/server/utils/songkongSettings', async () => {
  const actual = await vi.importActual<typeof import('../../../server/utils/songkongSettings')>('../../../server/utils/songkongSettings')
  return {
    ...actual,
    songkongDirs: () => ({ root: '/state', spool: '/state/spool', done: '/state/done' }),
    resolveSongkongEnabled: vi.fn(),
  }
})

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

describe('readSongkongHealth', () => {
  afterEach(() => vi.clearAllMocks())

  it('reports empty/not-stalled when the spool directory is empty', async () => {
    vi.mocked(readdir).mockResolvedValue([] as any)
    const { resolveSongkongEnabled } = await import('../../../server/utils/songkongSettings')
    vi.mocked(resolveSongkongEnabled).mockResolvedValue(true)

    const health = await readSongkongHealth()

    expect(health).toEqual({
      enabled: true, spoolCount: 0, oldestSpoolMin: null, stalled: false, maxWaitMin: 30,
    })
  })

  it('reports the oldest entry age and stalled status from spool mtimes', async () => {
    vi.mocked(readdir).mockResolvedValue(['a', 'b'] as any)
    vi.mocked(stat).mockImplementation((path: any) => {
      const ageMin = String(path).endsWith('a') ? 20 : 5
      return Promise.resolve({ mtimeMs: Date.now() - ageMin * 60_000 } as any)
    })
    const { resolveSongkongEnabled } = await import('../../../server/utils/songkongSettings')
    vi.mocked(resolveSongkongEnabled).mockResolvedValue(false)

    const health = await readSongkongHealth()

    expect(health.enabled).toBe(false)
    expect(health.spoolCount).toBe(2)
    expect(health.oldestSpoolMin).toBeGreaterThanOrEqual(19)
    expect(health.stalled).toBe(true)
  })

  it('falls back to disabled when resolveSongkongEnabled throws', async () => {
    vi.mocked(readdir).mockResolvedValue([] as any)
    const { resolveSongkongEnabled } = await import('../../../server/utils/songkongSettings')
    vi.mocked(resolveSongkongEnabled).mockRejectedValue(new Error('db down'))

    const health = await readSongkongHealth()

    expect(health.enabled).toBe(false)
  })
})
