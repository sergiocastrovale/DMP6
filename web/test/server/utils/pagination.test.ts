import { describe, expect, it } from 'vitest'
import { parsePagination } from '../../../server/utils/pagination'

describe('parsePagination', () => {
  it('applies defaults when the query is empty', () => {
    expect(parsePagination({})).toEqual({ page: 1, pageSize: 20, skip: 0 })
  })

  it('honors custom defaultSize/maxSize', () => {
    expect(parsePagination({}, { defaultSize: 50, maxSize: 200 })).toEqual({ page: 1, pageSize: 50, skip: 0 })
  })

  it('computes skip from page and pageSize', () => {
    expect(parsePagination({ page: '3', pageSize: '10' })).toEqual({ page: 3, pageSize: 10, skip: 20 })
  })

  it('clamps page to a minimum of 1', () => {
    expect(parsePagination({ page: '0' }).page).toBe(1)
    expect(parsePagination({ page: '-5' }).page).toBe(1)
  })

  it('clamps pageSize to maxSize', () => {
    expect(parsePagination({ pageSize: '9999' }, { maxSize: 100 }).pageSize).toBe(100)
  })

  it('clamps a truthy-negative pageSize to a minimum of 1', () => {
    expect(parsePagination({ pageSize: '-5' }).pageSize).toBe(1)
  })

  it('a pageSize of "0" is falsy, so it falls back to the default rather than being clamped to 1', () => {
    expect(parsePagination({ pageSize: '0' }).pageSize).toBe(20)
  })

  it('falls back to defaults for non-numeric input', () => {
    expect(parsePagination({ page: 'abc', pageSize: 'xyz' })).toEqual({ page: 1, pageSize: 20, skip: 0 })
  })
})
