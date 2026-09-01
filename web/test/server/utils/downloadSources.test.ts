import { describe, expect, it } from 'vitest'
import { chooseSource, RT_PRIORITY, SLSK_PRIORITY } from '../../../server/utils/downloadSources'
import type { DownloadSourceConfigItem } from '../../../types/download'

const configs = (overrides: Partial<Record<'RUTRACKER' | 'SLSKD', Partial<DownloadSourceConfigItem>>> = {}): DownloadSourceConfigItem[] => [
  { name: 'RUTRACKER', url: 'https://rutracker.org', retry: false, enabled: true, ...overrides.RUTRACKER },
  { name: 'SLSKD', url: null, retry: true, enabled: true, ...overrides.SLSKD },
]

describe('chooseSource', () => {
  it('picks RuTracker first at fresh priority when enabled, untried, and budget ok', () => {
    expect(chooseSource(RT_PRIORITY, [], configs())).toBe('RUTRACKER')
  })

  it('falls through to Soulseek once priority drops to the SLSK band', () => {
    expect(chooseSource(SLSK_PRIORITY, [], configs())).toBe('SLSKD')
  })

  it('falls through to Soulseek when RuTracker was already tried', () => {
    expect(chooseSource(RT_PRIORITY, ['RUTRACKER'], configs())).toBe('SLSKD')
  })

  it('falls through to Soulseek (without marking RT tried) when the RT budget is exhausted', () => {
    expect(chooseSource(RT_PRIORITY, [], configs(), false)).toBe('SLSKD')
  })

  it('skips RuTracker when disabled', () => {
    expect(chooseSource(RT_PRIORITY, [], configs({ RUTRACKER: { enabled: false } }))).toBe('SLSKD')
  })

  it('returns null when both sources are disabled', () => {
    expect(chooseSource(RT_PRIORITY, [], configs({ RUTRACKER: { enabled: false }, SLSKD: { enabled: false } }))).toBeNull()
  })

  it('returns null when priority is in the SLSK band and Soulseek is disabled', () => {
    expect(chooseSource(SLSK_PRIORITY, [], configs({ SLSKD: { enabled: false } }))).toBeNull()
  })

  it('never re-tries RuTracker once tried, even at fresh priority and budget ok', () => {
    expect(chooseSource(RT_PRIORITY, ['RUTRACKER'], configs())).toBe('SLSKD')
  })
})
