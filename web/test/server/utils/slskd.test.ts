import { describe, expect, it } from 'vitest'
import {
  detectFormat,
  isAudioFile,
  isSlskdFailed,
  isSlskdSucceeded,
  isSlskdTerminal,
  scoreSlskdResult,
  stripSlskdSuffix,
} from '../../../server/utils/slskd'

describe('isAudioFile', () => {
  it('recognizes known audio extensions case-insensitively', () => {
    expect(isAudioFile('track.FLAC')).toBe(true)
    expect(isAudioFile('track.mp3')).toBe(true)
    expect(isAudioFile('track.opus')).toBe(true)
  })

  it('rejects non-audio files', () => {
    expect(isAudioFile('cover.jpg')).toBe(false)
    expect(isAudioFile('readme.txt')).toBe(false)
    expect(isAudioFile('noext')).toBe(false)
  })
})

describe('isSlskdTerminal / isSlskdSucceeded / isSlskdFailed', () => {
  it('terminal states start with "Completed"', () => {
    expect(isSlskdTerminal('Completed, Succeeded')).toBe(true)
    expect(isSlskdTerminal('InProgress')).toBe(false)
    expect(isSlskdTerminal('Queued, Remotely')).toBe(false)
  })

  it('succeeded requires the Succeeded substring', () => {
    expect(isSlskdSucceeded('Completed, Succeeded')).toBe(true)
    expect(isSlskdSucceeded('Completed, Errored')).toBe(false)
  })

  it('failed is terminal but not succeeded', () => {
    expect(isSlskdFailed('Completed, Errored')).toBe(true)
    expect(isSlskdFailed('Completed, Cancelled')).toBe(true)
    expect(isSlskdFailed('Completed, Succeeded')).toBe(false)
    expect(isSlskdFailed('InProgress')).toBe(false)
  })
})

describe('stripSlskdSuffix', () => {
  it('strips the slskd collision suffix before the extension', () => {
    expect(stripSlskdSuffix('01. Stone_639171186044183498.flac')).toBe('01. Stone.flac')
  })

  it('leaves a normal filename untouched', () => {
    expect(stripSlskdSuffix('01. Stone.flac')).toBe('01. Stone.flac')
  })

  it('does not strip a short numeric suffix (< 6 digits)', () => {
    expect(stripSlskdSuffix('Track 12345.flac')).toBe('Track 12345.flac')
  })

  it('documented false positive: a real title ending in 6+ digits gets stripped too', () => {
    // e.g. a track literally titled "...Track_123456" loses its trailing digits - known limitation.
    expect(stripSlskdSuffix('Track_123456.flac')).toBe('Track.flac')
  })
})

describe('detectFormat', () => {
  it('maps known extensions to display formats', () => {
    expect(detectFormat('x.flac')).toBe('FLAC')
    expect(detectFormat('x.mp3')).toBe('MP3')
    expect(detectFormat('x.ogg')).toBe('OGG')
    expect(detectFormat('x.opus')).toBe('OGG')
    expect(detectFormat('x.aac')).toBe('AAC')
    expect(detectFormat('x.m4a')).toBe('AAC')
  })

  it('uppercases unknown extensions', () => {
    expect(detectFormat('x.wav')).toBe('WAV')
  })
})

describe('scoreSlskdResult', () => {
  it('scores FLAC highest by format', () => {
    const flac = scoreSlskdResult('FLAC', 0, 1, 0, 0, false)
    const mp3High = scoreSlskdResult('MP3', 320, 1, 0, 0, false)
    expect(flac).toBeGreaterThan(mp3High)
  })

  it('ranks MP3 bitrate tiers correctly', () => {
    const mp3_320 = scoreSlskdResult('MP3', 320, 0, 0, 0, false)
    const mp3_256 = scoreSlskdResult('MP3', 256, 0, 0, 0, false)
    const mp3_128 = scoreSlskdResult('MP3', 128, 0, 0, 0, false)
    expect(mp3_320).toBeGreaterThan(mp3_256)
    expect(mp3_256).toBeGreaterThan(mp3_128)
  })

  it('rewards a free upload slot and penalizes a busy queue', () => {
    const withSlot = scoreSlskdResult('FLAC', 0, 1, 0, 0, true)
    const noSlot = scoreSlskdResult('FLAC', 0, 1, 0, 0, false)
    expect(withSlot).toBeGreaterThan(noSlot)

    const shortQueue = scoreSlskdResult('FLAC', 0, 1, 0, 5, true)
    const longQueue = scoreSlskdResult('FLAC', 0, 1, 0, 60, true)
    expect(shortQueue).toBeGreaterThan(longQueue)
  })

  it('never goes below zero', () => {
    const worst = scoreSlskdResult('OTHER', 0, 0, 0, 999, false)
    expect(worst).toBeGreaterThanOrEqual(0)
  })
})
