import { describe, it, expect } from 'vitest'
import {
  acquireBodySchema, cancelDownloadBodySchema, pauseBodySchema, deleteMonitorEventsBodySchema,
} from '../../../server/schemas/downloads'

describe('acquireBodySchema', () => {
  it('needs a release row id; the replaced release is optional', () => {
    expect(acquireBodySchema.parse({ mbReleaseRowId: 'r' })).toEqual({ mbReleaseRowId: 'r', replacesLocalReleaseId: undefined })
    expect(acquireBodySchema.parse({ mbReleaseRowId: 'r', replacesLocalReleaseId: 'l' }).replacesLocalReleaseId).toBe('l')
    expect(acquireBodySchema.parse({ mbReleaseRowId: 'r', replacesLocalReleaseId: '' }).replacesLocalReleaseId).toBeUndefined()
    expect(acquireBodySchema.safeParse({}).success).toBe(false)
    expect(acquireBodySchema.safeParse({ mbReleaseRowId: '' }).success).toBe(false)
  })
})

describe('cancelDownloadBodySchema', () => {
  it('defaults the username and requires an id', () => {
    expect(cancelDownloadBodySchema.parse({ id: 'x' })).toEqual({ id: 'x', username: '' })
    expect(cancelDownloadBodySchema.parse({ id: 'x', username: 'u' }).username).toBe('u')
    expect(cancelDownloadBodySchema.safeParse({}).success).toBe(false)
  })
})

describe('pauseBodySchema', () => {
  it('needs a real boolean', () => {
    expect(pauseBodySchema.parse({ paused: false })).toEqual({ paused: false })
    expect(pauseBodySchema.safeParse({}).success).toBe(false)
    expect(pauseBodySchema.safeParse({ paused: 'true' }).success).toBe(false)
  })
})

describe('deleteMonitorEventsBodySchema', () => {
  it('accepts ids or allArchived and rejects wrong types', () => {
    expect(deleteMonitorEventsBodySchema.parse({ ids: ['a'] }).ids).toEqual(['a'])
    expect(deleteMonitorEventsBodySchema.parse({ allArchived: true }).allArchived).toBe(true)
    expect(deleteMonitorEventsBodySchema.parse({})).toEqual({})
    expect(deleteMonitorEventsBodySchema.safeParse({ ids: 'a' }).success).toBe(false)
    expect(deleteMonitorEventsBodySchema.safeParse({ allArchived: 'yes' }).success).toBe(false)
  })
})
