import { describe, expect, it } from 'vitest'
import { computeReleaseStats, mergeReleaseStats, sortArtistsInMemory } from '../../../server/utils/artistReleaseStats'

describe('computeReleaseStats', () => {
  it('counts releases and complete releases per artist', () => {
    const stats = computeReleaseStats([
      { artistId: 'a1', localRelease: { id: 'r1', matchStatus: 'COMPLETE' } },
      { artistId: 'a1', localRelease: { id: 'r2', matchStatus: 'MISSING_TRACKS' } },
      { artistId: 'a2', localRelease: { id: 'r3', matchStatus: 'COMPLETE' } },
    ])
    expect(stats.get('a1')).toEqual({ releaseCount: 2, completeCount: 1 })
    expect(stats.get('a2')).toEqual({ releaseCount: 1, completeCount: 1 })
  })

  it('dedupes a release shared by multiple co-owners for the same artist', () => {
    const stats = computeReleaseStats([
      { artistId: 'a1', localRelease: { id: 'shared', matchStatus: 'COMPLETE' } },
      { artistId: 'a1', localRelease: { id: 'shared', matchStatus: 'COMPLETE' } },
    ])
    expect(stats.get('a1')).toEqual({ releaseCount: 1, completeCount: 1 })
  })

  it('returns an empty map for no links', () => {
    expect(computeReleaseStats([]).size).toBe(0)
  })
})

describe('mergeReleaseStats', () => {
  it('attaches releaseCount/completeCount onto each item by id', () => {
    const items = [{ id: 'a1', name: 'Artist One' }, { id: 'a2', name: 'Artist Two' }]
    const links = [{ artistId: 'a1', localRelease: { id: 'r1', matchStatus: 'COMPLETE' } }]
    const merged = mergeReleaseStats(items, links)
    expect(merged).toEqual([
      { id: 'a1', name: 'Artist One', releaseCount: 1, completeCount: 1 },
      { id: 'a2', name: 'Artist Two', releaseCount: 0, completeCount: 0 },
    ])
  })

  it('defaults to zero counts for an item with no matching links', () => {
    const merged = mergeReleaseStats([{ id: 'a1' }], [])
    expect(merged[0]).toMatchObject({ releaseCount: 0, completeCount: 0 })
  })
})

describe('sortArtistsInMemory', () => {
  const rows = [
    { id: 'a1', releaseCount: 2, completeCount: 1 },
    { id: 'a2', releaseCount: 5, completeCount: 5 },
    { id: 'a3', releaseCount: 0, completeCount: 0 },
  ]

  it('sorts by releaseCount descending for sort=releases', () => {
    expect(sortArtistsInMemory(rows, 'releases').map(r => r.id)).toEqual(['a2', 'a1', 'a3'])
  })

  it('sorts by completeness fraction descending for sort=completeness', () => {
    expect(sortArtistsInMemory(rows, 'completeness').map(r => r.id)).toEqual(['a2', 'a1', 'a3'])
  })

  it('honours an ascending direction on both computed columns', () => {
    // These two have no DB column to orderBy, so the direction the toolbar toggle sends has to be
    // applied here or it would silently do nothing on exactly these columns.
    expect(sortArtistsInMemory(rows, 'releases', 'asc').map(r => r.id)).toEqual(['a3', 'a1', 'a2'])
    expect(sortArtistsInMemory(rows, 'completeness', 'asc').map(r => r.id)).toEqual(['a3', 'a1', 'a2'])
  })

  it('defaults to descending when no direction is given', () => {
    expect(sortArtistsInMemory(rows, 'releases').map(r => r.id))
      .toEqual(sortArtistsInMemory(rows, 'releases', 'desc').map(r => r.id))
  })

  it('treats zero releases as a 0 completeness fraction, not NaN, and sorts it last', () => {
    const sorted = sortArtistsInMemory(rows, 'completeness')
    expect(sorted.at(-1)!.id).toBe('a3')
  })

  it('returns items unchanged for any other sort key', () => {
    expect(sortArtistsInMemory(rows, 'name')).toBe(rows)
  })

  it('does not mutate the input array', () => {
    const input = [...rows]
    sortArtistsInMemory(input, 'releases')
    expect(input.map(r => r.id)).toEqual(['a1', 'a2', 'a3'])
  })
})
