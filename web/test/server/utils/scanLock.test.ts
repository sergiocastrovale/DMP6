import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('node:fs', () => {
  const mocks = { readFileSync: vi.fn() }
  return { ...mocks, default: mocks }
})

const { commMatchesBinary, isOwnScanProcess, KNOWN_LOCK_BINARIES } = await import('../../../server/utils/scanLock')

describe('KNOWN_LOCK_BINARIES', () => {
  // Regression test for a real drift: 'add' and 'tidy' both call common::lock::acquire_lock (their
  // Rust main.rs files do) but were missing from this set, so isOwnScanProcess/commMatchesBinary
  // always rejected them - breaking Stop's SIGTERM-to-PID branch for those two commands specifically.
  it('contains every binary that calls acquire_lock', () => {
    expect([...KNOWN_LOCK_BINARIES].sort()).toEqual(
      ['add', 'delete', 'fix', 'index', 'nuke', 'playlists', 'sync', 'tidy'].sort(),
    )
  })
})

describe('commMatchesBinary', () => {
  it('matches a known binary against its own /proc comm', () => {
    expect(commMatchesBinary('sync', 'sync')).toBe(true)
  })

  it('tolerates the trailing newline /proc/<pid>/comm reads normally carry', () => {
    expect(commMatchesBinary('sync\n', 'sync')).toBe(true)
  })

  it('rejects a comm belonging to a different known binary', () => {
    expect(commMatchesBinary('index', 'sync')).toBe(false)
  })

  it('rejects an expectedBinary that never calls acquire_lock', () => {
    expect(commMatchesBinary('node', 'node')).toBe(false)
  })

  it('rejects a null expectedBinary (no lock recorded)', () => {
    expect(commMatchesBinary('sync', null)).toBe(false)
  })
})

describe('isOwnScanProcess', () => {
  it('is true when /proc/<pid>/comm matches the expected binary', () => {
    vi.mocked(readFileSync).mockReturnValue('sync\n' as any)

    expect(isOwnScanProcess(123, 'sync')).toBe(true)
  })

  it('is false when the comm read throws (pid gone, or not our namespace)', () => {
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('ENOENT') })

    expect(isOwnScanProcess(123, 'sync')).toBe(false)
  })
})
