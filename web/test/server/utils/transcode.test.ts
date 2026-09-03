import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildTrackFilename, collectAudioFiles, ext, ffmpegAvailable, probeTags, sanitize, transcodeDirToMp3320, TRACK_EXTENSIONS,
} from '../../../server/utils/transcode'

const execFileMock = vi.fn()
vi.mock('node:child_process', () => {
  const execFile = (...args: unknown[]) => execFileMock(...args)
  return { execFile, default: { execFile } }
})

describe('TRACK_EXTENSIONS', () => {
  it('includes mp3 plus every convertible lossless format', () => {
    expect(TRACK_EXTENSIONS.has('mp3')).toBe(true)
    expect(TRACK_EXTENSIONS.has('flac')).toBe(true)
    expect(TRACK_EXTENSIONS.has('wav')).toBe(true)
  })

  it('excludes non-audio extensions', () => {
    expect(TRACK_EXTENSIONS.has('jpg')).toBe(false)
    expect(TRACK_EXTENSIONS.has('txt')).toBe(false)
  })
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

  it('converts a lossless file to mp3 and removes the source on success', async () => {
    await writeFile(join(dir, 'track1.flac'), 'fake-audio')

    execFileMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (e: Error | null, o: string, err: string) => void
      const cmd = args[0]
      const cmdArgs = args[1] as string[]
      if (cmd === 'ffmpeg' && cmdArgs.includes('-version')) {
        cb(null, 'ffmpeg version 6.0', '')
        return
      }
      if (cmd === 'ffmpeg') {
        // Simulate ffmpeg actually producing the .part output file before reporting success.
        const part = cmdArgs[cmdArgs.length - 1]!
        writeFile(part, 'fake-mp3-data').then(() => cb(null, '', ''), e => cb(e, '', ''))
        return
      }
      // ffprobe: report no usable tags so renameFromTags is a no-op.
      cb(null, JSON.stringify({ format: { tags: {} }, streams: [] }), '')
    })

    const result = await transcodeDirToMp3320(dir)

    expect(result).toEqual({ converted: 1, failed: 0 })
    await expect(readFile(join(dir, 'track1.mp3'), 'utf8')).resolves.toBe('fake-mp3-data')
    await expect(readFile(join(dir, 'track1.flac'), 'utf8')).rejects.toThrow() // source removed
    // Default bitrate when the caller doesn't pass one.
    const ffmpegCall = execFileMock.mock.calls.find(c => c[0] === 'ffmpeg' && (c[1] as string[]).includes('-b:a'))
    expect(ffmpegCall![1]).toEqual(expect.arrayContaining(['-b:a', '320k']))
  })

  it('encodes at the requested bitrate (Settings.flacToMp3Bitrate/FLAC_TO_MP3_BITRATE) instead of hardcoded 320', async () => {
    await writeFile(join(dir, 'track1.flac'), 'fake-audio')

    execFileMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (e: Error | null, o: string, err: string) => void
      const cmd = args[0]
      const cmdArgs = args[1] as string[]
      if (cmd === 'ffmpeg' && cmdArgs.includes('-version')) {
        cb(null, 'ffmpeg version 6.0', '')
        return
      }
      if (cmd === 'ffmpeg') {
        const part = cmdArgs[cmdArgs.length - 1]!
        writeFile(part, 'fake-mp3-data').then(() => cb(null, '', ''), e => cb(e, '', ''))
        return
      }
      cb(null, JSON.stringify({ format: { tags: {} }, streams: [] }), '')
    })

    await transcodeDirToMp3320(dir, 192)

    const ffmpegCall = execFileMock.mock.calls.find(c => c[0] === 'ffmpeg' && (c[1] as string[]).includes('-b:a'))
    expect(ffmpegCall![1]).toEqual(expect.arrayContaining(['-b:a', '192k']))
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

describe('collectAudioFiles', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dmp-collect-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('recursively lists files across nested subdirectories', async () => {
    await mkdir(join(dir, 'sub'), { recursive: true })
    await writeFile(join(dir, 'a.mp3'), 'x')
    await writeFile(join(dir, 'sub', 'b.flac'), 'x')

    const files = await collectAudioFiles(dir)

    expect(files.sort()).toEqual([join(dir, 'a.mp3'), join(dir, 'sub', 'b.flac')].sort())
  })

  it('returns an empty list for a directory that does not exist', async () => {
    expect(await collectAudioFiles(join(dir, 'missing'))).toEqual([])
  })

  it('gives up past the recursion depth guard', async () => {
    expect(await collectAudioFiles(dir, 7)).toEqual([])
  })
})

describe('probeTags', () => {
  beforeEach(() => execFileMock.mockReset())

  const stubFfprobe = (formatTags: Record<string, string>) => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const cb = args.find(a => typeof a === 'function') as ((e: Error | null, o: { stdout: string; stderr: string }) => void) | undefined
      if (!cb) { return }
      const stdout = JSON.stringify({ format: { tags: formatTags }, streams: [] })
      // execFileAsync (promisify) invokes the callback with (err, {stdout, stderr}).
      cb(null, { stdout, stderr: '' } as any)
    })
  }

  it('reads track/title/disc/year tags, case-insensitively', async () => {
    stubFfprobe({ TRACK: '3', Title: 'Intro', date: '2007-11-20' })

    const tags = await probeTags('/music/track.mp3')

    expect(tags).toEqual({ track: '3', title: 'Intro', disc: undefined, discTotal: undefined, year: '2007' })
  })

  it('returns undefined fields when no tags are present', async () => {
    stubFfprobe({})

    expect(await probeTags('/music/track.mp3')).toEqual({
      track: undefined, title: undefined, disc: undefined, discTotal: undefined, year: undefined,
    })
  })
})
