import { describe, expect, it } from 'vitest'
import { apiErrorMessage, shouldReportError } from '../../helpers/apiError'

describe('apiErrorMessage', () => {
  it('prefers the server message, then its statusMessage', () => {
    expect(apiErrorMessage({ data: { message: 'Playlist with this name already exists' } }, 'x')).toBe('Playlist with this name already exists')
    expect(apiErrorMessage({ data: { statusMessage: 'Track not found' } }, 'x')).toBe('Track not found')
    expect(apiErrorMessage({ data: { message: '  ', statusMessage: 'Nope' } }, 'x')).toBe('Nope')
  })

  it('falls back to the caller wording, never ofetch\'s route-naming message', () => {
    expect(apiErrorMessage(new Error('[POST] "/api/x": 500 Internal Server Error'), 'Could not save')).toBe('Could not save')
    expect(apiErrorMessage(null, 'Could not save')).toBe('Could not save')
    expect(apiErrorMessage({ data: { message: 5 } }, 'Could not save')).toBe('Could not save')
  })
})

describe('shouldReportError', () => {
  it('does not report a cancelled request', () => {
    expect(shouldReportError({ name: 'AbortError' })).toBe(false)
    expect(shouldReportError({ name: 'FetchError', cause: { name: 'AbortError' } })).toBe(false)
    expect(shouldReportError(new Error('boom'))).toBe(true)
  })
})
