import { describe, expect, it } from 'vitest'
import { defaultSortDirection, isSortDirection, resolveSortDirection } from '../../helpers/browseSort'

describe('defaultSortDirection', () => {
  it('reads names A-Z but every quantity biggest-first', () => {
    expect(defaultSortDirection('name')).toBe('asc')
    for (const field of ['releases', 'tracks', 'completeness', 'playCount', 'score', 'recent']) {
      expect(defaultSortDirection(field)).toBe('desc')
    }
  })

  it('treats an unknown field as a quantity rather than throwing', () => {
    expect(defaultSortDirection('whatever')).toBe('desc')
  })
})

describe('isSortDirection', () => {
  it.each([['asc', true], ['desc', true], ['ASC', false], ['', false], [undefined, false], [null, false], [1, false]])(
    'rejects anything that is not exactly asc/desc (%s)',
    (input, expected) => {
      expect(isSortDirection(input)).toBe(expected)
    },
  )
})

describe('resolveSortDirection', () => {
  it('honours an explicit direction', () => {
    expect(resolveSortDirection('name', 'desc')).toBe('desc')
    expect(resolveSortDirection('playCount', 'asc')).toBe('asc')
  })

  it("falls back to the field's default when the caller sent nothing usable", () => {
    // A direct API call, or a link carrying only ?sort=
    expect(resolveSortDirection('name', undefined)).toBe('asc')
    expect(resolveSortDirection('playCount', undefined)).toBe('desc')
    expect(resolveSortDirection('name', 'sideways')).toBe('asc')
  })
})
