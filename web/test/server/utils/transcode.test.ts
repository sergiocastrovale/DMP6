import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTrackFilename, ext, ffmpegAvailable, sanitize, transcodeDirToMp3320 } from '../../../server/utils/transcode'

const execFileMock = vi.fn()
vi.mock('node:child_process', () => {
  const execFile = (...args: unknown[]) => execFileMock(...args)
  return { execFile, default: { execFile } }
})

describe('ext', () => {
  it('returns the lowercased extension without the dot', () => {
    expect(ext('Track.FLAC')).toBe('flac')
    expect(ext('/a/b/track.mp3')).toBe('mp3')
  })

  it('returns empty string for no extension', () => {
    expect(ext('noext')).toBe('')
  })
})

describe('sanitize', () => {
  it('replaces filesystem-illegal characters with underscores', () => {
    expect(sanitize('Who: Made Who? <Deluxe>')).toBe('Who_ Made Who_ _Deluxe_')
  })

  it('collapses whitespace and trims', () => {
    expect(sanitize('  Spaced   Out  ')).toBe('Spaced Out')
  })

  it('truncates to 200 characters', () => {
    expect(sanitize('A'.repeat(300)).length).toBe(200)
  })
})

describe('buildTrackFilename', () => {
  it('builds NN. Title.mp3 for a single-disc release', () => {
    expect(buildTrackFilename({ track: '3', title: 'Intro' })).toBe('03. Intro.mp3')
  })

  it('returns null when track or title is missing', () => {
    expect(buildTrackFilename({ title: 'Intro' })).toBeNull()
    expect(buildTrackFilename({ track: '3' })).toBeNull()
  })

  it('returns null when track is not a parseable number', () => {
    expect(buildTrackFilename({ track: 'abc', title: 'Intro' })).toBeNull()
  })

  it('handles a "N/total" track tag', () => {
    expect(buildTrackFilename({ track: '3/12', title: 'Intro' })).toBe('03. Intro.mp3')
  })

  it('prefixes the disc number when discTotal > 1 - Disc 1/Disc 2 Track 1 no longer collide (audit #83)', () => {
    const disc1 = buildTrackFilename({ track: '1', title: 'Same Track Name', disc: '1', discTotal: '2' })
    const disc2 = buildTrackFilename({ track: '1', title: 'Same Track Name', disc: '2', discTotal: '2' })
    expect(disc1).toBe('1-01. Same Track Name.mp3')
    expect(disc2).toBe('2-01. Same Track Name.mp3')
    expect(disc1).not.toBe(disc2)
  })

  it('does not prefix disc when discTotal is 1 or absent', () => {
    expect(buildTrackFilename({ track: '1', title: 'Intro', disc: '1', discTotal: '1' })).toBe('01. Intro.mp3')
    expect(buildTrackFilename({ track: '1', title: 'Intro', disc: '1' })).toBe('01. Intro.mp3')
  })
})

// Audit item 2: ffmpeg missing/errored must fail loudly (a single pre-flight check) instead of
// silently leaving lossless files un-transcoded, which the library layout can't recognize as tracks.
describe('transcodeDirToMp3320: ffmpeg pre-flight gate (audit item 2)', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dmp-transcode-'))
    execFileMock.mockReset()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('ffmpeg missing: every convertible file is marked failed without attempting per-file conversion', async () => {
    await writeFile(join(dir, 'track1.flac'), 'fake-audio')
    await writeFile(join(dir, 'track2.flac'), 'fake-audio')

    // No options object at this call site (execFileAsync('ffmpeg', ['-version'])) — the callback is
    // whichever arg comes last, not always index 3.
    execFileMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (e: Error | null, o: string, err: string) => void
      cb(new Error('ENOENT: ffmpeg not found'), '', '')
    })

    const result = await transcodeDirToMp3320(dir)

    expect(result).toEqual({ converted: 0, failed: 2 })
    // Only the -version probe ran — no per-file ffmpeg invocation for either flac file.
    expect(execFileMock).toHaveBeenCalledTimes(1)
    expect(execFileMock.mock.calls[0]![0]).toBe('ffmpeg')
    expect(execFileMock.mock.calls[0]![1]).toEqual(['-version'])
  })

  it('no convertible files present (empty dir): skips the ffmpeg pre-flight entirely', async () => {
    const result = await transcodeDirToMp3320(dir)

    expect(result).toEqual({ converted: 0, failed: 0 })
    expect(execFileMock).not.toHaveBeenCalled()
  })

  it('ffmpegAvailable() reflects ffmpeg -version success/failure', async () => {
    // No options object at this call site (execFileAsync('ffmpeg', ['-version'])), so the callback is
    // whichever arg comes last, not always index 3.
    const withCb = (result: [Error | null, string, string]) => (...args: unknown[]) => {
      const cb = args[args.length - 1] as (e: Error | null, o: string, err: string) => void
      cb(...result)
    }

    execFileMock.mockImplementation(withCb([null, 'ffmpeg version 6.0', '']))
    expect(await ffmpegAvailable()).toBe(true)

    execFileMock.mockImplementation(withCb([new Error('ENOENT'), '', '']))
    expect(await ffmpegAvailable()).toBe(false)
  })
})
