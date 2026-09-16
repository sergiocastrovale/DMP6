import { describe, expect, it } from 'vitest'
import { mapErrorToSubsonic, SubsonicApiError, SubsonicErrorCode } from '../../../../server/utils/subsonic/errors'

describe('mapErrorToSubsonic', () => {
  it('passes a SubsonicApiError through with its own code', () => {
    const e = new SubsonicApiError(SubsonicErrorCode.INVALID_API_KEY, 'nope')
    expect(mapErrorToSubsonic(e)).toEqual({ code: 44, message: 'nope' })
  })

  it('maps common h3 statusCodes to Subsonic codes', () => {
    expect(mapErrorToSubsonic({ statusCode: 400, statusMessage: 'bad' })).toEqual({ code: 10, message: 'bad' })
    expect(mapErrorToSubsonic({ statusCode: 401, statusMessage: 'unauth' })).toEqual({ code: 40, message: 'unauth' })
    expect(mapErrorToSubsonic({ statusCode: 403, statusMessage: 'forbidden' })).toEqual({ code: 50, message: 'forbidden' })
    expect(mapErrorToSubsonic({ statusCode: 404, statusMessage: 'missing' })).toEqual({ code: 70, message: 'missing' })
  })

  it('falls back to GENERIC for an unmapped or missing statusCode', () => {
    expect(mapErrorToSubsonic({ statusCode: 500, statusMessage: 'boom' })).toEqual({ code: 0, message: 'boom' })
    expect(mapErrorToSubsonic(new Error('plain'))).toEqual({ code: 0, message: 'plain' })
  })

  it('falls back to a generic message when none is present', () => {
    expect(mapErrorToSubsonic({})).toEqual({ code: 0, message: 'Server error' })
  })
})
