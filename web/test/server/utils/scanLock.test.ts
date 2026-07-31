import { describe, expect, it } from 'vitest'
import { commMatchesBinary } from '../../../server/utils/scanLock'

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
