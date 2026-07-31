import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  detectFormat,
  isAudioFile,
  isSlskdFailed,
  isSlskdSucceeded,
  isSlskdTerminal,
  relocateDownloadedFiles,
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

  it('does not strip a short numeric suffix (< 15 digits)', () => {
    expect(stripSlskdSuffix('Track 12345.flac')).toBe('Track 12345.flac')
  })

  it('no longer mangles a real title ending in 6-14 digits — only 15+ (the actual slskd token width) strips', () => {
    // Previously the regex fired on 6+ digits, so a track literally titled "...Track_200601" (a date-like
    // suffix, well short of slskd's 18-or-more digit collision token) lost its trailing digits.
    expect(stripSlskdSuffix('Track_200601.flac')).toBe('Track_200601.flac')
    expect(stripSlskdSuffix('Track_123456.flac')).toBe('Track_123456.flac')
  })

  it('still strips a real (18+ digit) slskd collision token', () => {
    expect(stripSlskdSuffix('Track_639171186044183498.flac')).toBe('Track.flac')
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

describe('relocateDownloadedFiles: basename collisions across concurrent downloads', () => {
  const roots: string[] = []
  afterEach(async () => {
    await Promise.all(roots.splice(0).map(r => rm(r, { recursive: true, force: true })))
  })

  it('matches on basename AND size, so a same-named file from a different in-flight download is left untouched', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dmp-slskd-test-'))
    roots.push(root)

    // Two concurrent "downloads" (slskd writes everything flat, per docs/downloads_slskd.md) that
    // happen to share a track basename but are genuinely different files/sizes.
    const otherDownloadDir = join(root, 'peerA')
    const ourDownloadDir = join(root, 'peerB')
    await mkdir(otherDownloadDir, { recursive: true })
    await mkdir(ourDownloadDir, { recursive: true })
    await writeFile(join(otherDownloadDir, 'Track.mp3'), 'x'.repeat(500)) // belongs to another download
    await writeFile(join(ourDownloadDir, 'Track.mp3'), 'y'.repeat(999)) // ours

    const res = await relocateDownloadedFiles({
      username: 'peerB',
      files: [{ filename: 'Track.mp3', size: 999 }], // only OUR expected size
      downloadsPath: root,
      dirTemplate: '{artist}/{year} - {album}',
      artistName: 'Test Artist',
      albumTitle: 'Test Album',
      year: 2020,
    })

    expect(res.movedCount).toBe(1)
    const dest = join(root, 'Test Artist', '2020 - Test Album', 'Track.mp3')
    expect((await readFile(dest, 'utf8')).length).toBe(999) // ours, not the 500-byte impostor
    // The other download's file must be left in place, untouched.
    expect((await readFile(join(otherDownloadDir, 'Track.mp3'), 'utf8')).length).toBe(500)
  })

  it('falls back to name-only matching when size is unknown (0) — legacy behavior preserved', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dmp-slskd-test-'))
    roots.push(root)
    await writeFile(join(root, 'Track.mp3'), 'z'.repeat(42))

    const res = await relocateDownloadedFiles({
      username: 'peer1',
      files: [{ filename: 'Track.mp3', size: 0 }],
      downloadsPath: root,
      dirTemplate: '{artist}/{year} - {album}',
      artistName: 'Test Artist',
      albumTitle: 'Test Album',
      year: 2021,
    })

    expect(res.movedCount).toBe(1)
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
