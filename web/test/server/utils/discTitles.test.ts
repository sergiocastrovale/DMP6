import { describe, expect, it } from 'vitest'
import { buildDiscTitles } from '../../../server/utils/discTitles'

describe('buildDiscTitles', () => {
  it('uses MB medium titles, keyed by medium position', () => {
    const titles = buildDiscTitles('Deliverance & Damnation', [
      { position: 1, title: 'Deliverance', equivalentReleaseId: 'x' },
      { position: 2, title: 'Damnation', equivalentReleaseId: 'y' },
    ], new Map())
    expect(titles).toEqual({ 1: 'Deliverance', 2: 'Damnation' })
  })

  it('falls back to the title of the standalone release the disc reprints', () => {
    const titles = buildDiscTitles('The Candlelight Years', [
      { position: 1, title: null, equivalentReleaseId: 'orchid' },
      { position: 2, title: '  ', equivalentReleaseId: 'morningrise' },
    ], new Map([['orchid', 'Orchid'], ['morningrise', 'Morningrise']]))
    expect(titles).toEqual({ 1: 'Orchid', 2: 'Morningrise' })
  })

  it('leaves a disc untitled when neither source has a name', () => {
    const titles = buildDiscTitles('Box', [
      { position: 1, title: null, equivalentReleaseId: null },
      { position: 2, title: null, equivalentReleaseId: 'gone' },
    ], new Map())
    expect(titles).toEqual({})
  })

  it('drops a title that only repeats the release own title (a deluxe edition disc 1)', () => {
    const titles = buildDiscTitles('OK Computer', [
      { position: 1, title: null, equivalentReleaseId: 'standard' },
      { position: 2, title: 'Bonus Tracks', equivalentReleaseId: null },
    ], new Map([['standard', 'ok computer']]))
    expect(titles).toEqual({ 2: 'Bonus Tracks' })
  })
})
