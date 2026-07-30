import { describe, expect, it } from 'vitest'
import { DEFAULT_DOWNLOAD_DIR_TEMPLATE, resolveDownloadDir } from '../../../server/utils/downloadSettings'

describe('resolveDownloadDir', () => {
  it('renders artist/album/year placeholders', () => {
    expect(resolveDownloadDir(DEFAULT_DOWNLOAD_DIR_TEMPLATE, 'Boards of Canada', 'Geogaddi', 2002))
      .toBe('Boards of Canada/2002 - Geogaddi')
  })

  it('falls back to "Unknown Artist"/"Unknown Album" for empty strings', () => {
    expect(resolveDownloadDir('{artist}/{album}', '', '', undefined)).toBe('Unknown Artist/Unknown Album')
  })

  it('collapses the year placeholder and its separator when year is null', () => {
    expect(resolveDownloadDir(DEFAULT_DOWNLOAD_DIR_TEMPLATE, 'Artist', 'Album', null))
      .toBe('Artist/Album')
  })

  it('collapses the year placeholder when year is undefined', () => {
    expect(resolveDownloadDir(DEFAULT_DOWNLOAD_DIR_TEMPLATE, 'Artist', 'Album', undefined))
      .toBe('Artist/Album')
  })

  it('collapses the year placeholder when year is non-finite', () => {
    expect(resolveDownloadDir(DEFAULT_DOWNLOAD_DIR_TEMPLATE, 'Artist', 'Album', NaN))
      .toBe('Artist/Album')
  })

  it('sanitizes illegal filesystem characters in the placeholder values before insertion (a slash in the artist name cannot create an extra directory)', () => {
    expect(resolveDownloadDir('{artist}/{album}', 'AC/DC', 'Who: Made Who?', undefined))
      .toBe('AC_DC/Who_ Made Who_')
  })

  it('collapses repeated whitespace and trims', () => {
    expect(resolveDownloadDir('{artist}', '  Spaced   Out  ', '', undefined)).toBe('Spaced Out')
  })

  it('truncates an overlong segment to 200 characters', () => {
    const longName = 'A'.repeat(300)
    const result = resolveDownloadDir('{artist}', longName, '', undefined)
    expect(result.length).toBe(200)
  })

  it('preserves slashes as path segment separators while sanitizing each segment', () => {
    const result = resolveDownloadDir('{artist}/sub:dir/{album}', 'Artist', 'Al*bum', undefined)
    expect(result).toBe('Artist/sub_dir/Al_bum')
  })
})
