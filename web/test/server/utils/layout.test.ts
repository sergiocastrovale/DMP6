import { describe, expect, it } from 'vitest'
import { fileNameFromTags } from '../../../server/utils/layout'

describe('fileNameFromTags', () => {
  it('preserves the source file\'s own extension - not hardcoded .mp3 - since FLAC_TO_MP3=off leaves non-mp3 tracks untouched', () => {
    expect(fileNameFromTags({ track: '3', title: 'Track Title' }, '/staging/Track.flac'))
      .toBe('03. Track Title.flac')
  })

  it('still produces .mp3 for an mp3 source file', () => {
    expect(fileNameFromTags({ track: '1', title: 'Intro' }, '/staging/Intro.mp3'))
      .toBe('01. Intro.mp3')
  })

  it('falls back to the source basename (extension included) when tags are missing', () => {
    expect(fileNameFromTags({}, '/staging/01 - Unknown.flac')).toBe('01 - Unknown.flac')
  })

  it('falls back to the source basename when track is not a positive number', () => {
    expect(fileNameFromTags({ track: '0', title: 'x' }, '/staging/weird.flac')).toBe('weird.flac')
  })
})
