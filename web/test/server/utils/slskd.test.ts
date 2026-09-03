import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const downloadSettingsMocks = vi.hoisted(() => ({
  resolveDownloadSettings: vi.fn().mockResolvedValue({ slskdUrl: 'http://slskd.local:5030', slskdApiKey: 'key123', flacToMp3: true, flacToMp3Bitrate: 320 }),
}))

vi.mock('~/server/utils/downloadSettings', async () => {
  const actual = await vi.importActual<typeof import('../../../server/utils/downloadSettings')>('../../../server/utils/downloadSettings')
  return {
    ...actual,
    resolveDownloadSettings: downloadSettingsMocks.resolveDownloadSettings,
  }
})

const transcodeMocks = vi.hoisted(() => ({
  transcodeDirToMp3320: vi.fn().mockResolvedValue({ converted: 0, failed: 0 }),
}))

vi.mock('~/server/utils/transcode', async () => {
  const actual = await vi.importActual<typeof import('../../../server/utils/transcode')>('../../../server/utils/transcode')
  return {
    ...actual,
    transcodeDirToMp3320: transcodeMocks.transcodeDirToMp3320,
  }
})

const {
  detectFormat,
  isAudioFile,
  isSlskdFailed,
  isSlskdSucceeded,
  isSlskdTerminal,
  relocateDownloadedFiles,
  scoreSlskdResult,
  stripSlskdSuffix,
  clearSlskdConfigCache,
  checkSlskdConnection,
  slskdSearch,
  getSlskdSearchResults,
  deleteSlskdSearch,
  startSlskdDownload,
  getSlskdActiveDownloads,
  cancelSlskdDownload,
  purgeDownloadedSourceFiles,
} = await import('../../../server/utils/slskd')

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

describe('relocateDownloadedFiles: flacToMp3 gate', () => {
  const roots: string[] = []
  beforeEach(() => {
    transcodeMocks.transcodeDirToMp3320.mockClear()
  })
  afterEach(async () => {
    await Promise.all(roots.splice(0).map(r => rm(r, { recursive: true, force: true })))
    transcodeMocks.transcodeDirToMp3320.mockClear()
    downloadSettingsMocks.resolveDownloadSettings.mockResolvedValue({ slskdUrl: 'http://slskd.local:5030', slskdApiKey: 'key123', flacToMp3: true, flacToMp3Bitrate: 320 })
  })

  it('skips transcoding and leaves the FLAC file in place when flacToMp3 is false', async () => {
    downloadSettingsMocks.resolveDownloadSettings.mockResolvedValueOnce({ slskdUrl: 'http://slskd.local:5030', slskdApiKey: 'key123', flacToMp3: false, flacToMp3Bitrate: 320 })

    const root = await mkdtemp(join(tmpdir(), 'dmp-slskd-test-'))
    roots.push(root)
    await writeFile(join(root, 'Track.flac'), 'f'.repeat(10))

    const res = await relocateDownloadedFiles({
      username: 'peer1',
      files: [{ filename: 'Track.flac', size: 10 }],
      downloadsPath: root,
      dirTemplate: '{artist}/{year} - {album}',
      artistName: 'Test Artist',
      albumTitle: 'Test Album',
      year: 2022,
    })

    expect(res.movedCount).toBe(1)
    expect(transcodeMocks.transcodeDirToMp3320).not.toHaveBeenCalled()
    const dest = join(root, 'Test Artist', '2022 - Test Album', 'Track.flac')
    expect((await readFile(dest, 'utf8')).length).toBe(10)
  })

  it('transcodes when flacToMp3 is true (default)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dmp-slskd-test-'))
    roots.push(root)
    await writeFile(join(root, 'Track.flac'), 'f'.repeat(10))

    await relocateDownloadedFiles({
      username: 'peer1',
      files: [{ filename: 'Track.flac', size: 10 }],
      downloadsPath: root,
      dirTemplate: '{artist}/{year} - {album}',
      artistName: 'Test Artist',
      albumTitle: 'Test Album',
      year: 2023,
    })

    expect(transcodeMocks.transcodeDirToMp3320).toHaveBeenCalledTimes(1)
  })

  it('passes the resolved flacToMp3Bitrate through to transcodeDirToMp3320', async () => {
    downloadSettingsMocks.resolveDownloadSettings.mockResolvedValueOnce({ slskdUrl: 'http://slskd.local:5030', slskdApiKey: 'key123', flacToMp3: true, flacToMp3Bitrate: 192 })

    const root = await mkdtemp(join(tmpdir(), 'dmp-slskd-test-'))
    roots.push(root)
    await writeFile(join(root, 'Track.flac'), 'f'.repeat(10))

    await relocateDownloadedFiles({
      username: 'peer1',
      files: [{ filename: 'Track.flac', size: 10 }],
      downloadsPath: root,
      dirTemplate: '{artist}/{year} - {album}',
      artistName: 'Test Artist',
      albumTitle: 'Test Album',
      year: 2024,
    })

    expect(transcodeMocks.transcodeDirToMp3320).toHaveBeenCalledWith(expect.any(String), 192)
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

const jsonResponse = (body: unknown, status = 200): Response => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
} as unknown as Response)

describe('slskd network calls (mocked fetch)', () => {
  afterEach(() => {
    clearSlskdConfigCache()
    vi.unstubAllGlobals()
  })

  it('checkSlskdConnection reports connected when logged in', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ isLoggedIn: true })))

    expect(await checkSlskdConnection()).toEqual({ ok: true })
  })

  it('checkSlskdConnection reports not-logged-in distinctly from a connection failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ isLoggedIn: false })))

    const result = await checkSlskdConnection()

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/not logged in/)
  })

  it('checkSlskdConnection surfaces a non-ok status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)))

    const result = await checkSlskdConnection()

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/500/)
  })

  it('slskdSearch posts the query and returns the search id', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ id: 'search-123' }))
    vi.stubGlobal('fetch', fetchSpy)

    const id = await slskdSearch('some album', 5000)

    expect(id).toBe('search-123')
    const [url, init] = fetchSpy.mock.calls[0]!
    expect(String(url)).toContain('/searches')
    expect(JSON.parse(init.body).searchText).toBe('some album')
  })

  it('getSlskdSearchResults returns an empty array on a 404 (search expired)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null, 404)))

    expect(await getSlskdSearchResults('search-123')).toEqual([])
  })

  it('getSlskdSearchResults returns the parsed responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([{ username: 'peer1' }])))

    expect(await getSlskdSearchResults('search-123')).toEqual([{ username: 'peer1' }])
  })

  it('deleteSlskdSearch swallows a failed delete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

    await expect(deleteSlskdSearch('search-123')).resolves.toBeUndefined()
  })

  it('startSlskdDownload posts the file list to the username-scoped endpoint', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', fetchSpy)

    await startSlskdDownload('peer 1', [{ filename: 'a.flac', size: 10 }])

    const [url, init] = fetchSpy.mock.calls[0]!
    expect(String(url)).toContain('/transfers/downloads/peer%201')
    expect(JSON.parse(init.body)).toEqual([{ filename: 'a.flac', size: 10 }])
  })

  it('getSlskdActiveDownloads flattens the nested user/directory/file structure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([
      {
        username: 'peer1',
        directories: [{
          files: [{ id: 'f1', filename: 'track.flac', size: 100, state: 'InProgress', bytesTransferred: 50, percentComplete: 50, averageSpeed: 1000 }],
        }],
      },
    ])))

    const transfers = await getSlskdActiveDownloads()

    expect(transfers).toEqual([{
      id: 'f1', username: 'peer1', filename: 'track.flac', size: 100,
      state: 'InProgress', bytesTransferred: 50, percentComplete: 50, averageSpeed: 1000,
    }])
  })

  it('getSlskdActiveDownloads defaults missing fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([
      { username: 'peer1', directories: [{ files: [{ filename: 'track.flac' }] }] },
    ])))

    const transfers = await getSlskdActiveDownloads()

    expect(transfers).toEqual([{
      id: 'track.flac', username: 'peer1', filename: 'track.flac', size: 0,
      state: 'Unknown', bytesTransferred: 0, percentComplete: 0, averageSpeed: 0,
    }])
  })

  it('cancelSlskdDownload calls the remove endpoint for the given username/id', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({}))
    vi.stubGlobal('fetch', fetchSpy)

    await cancelSlskdDownload('peer 1', 'file 1')

    const [url] = fetchSpy.mock.calls[0]!
    expect(String(url)).toContain('/transfers/downloads/peer%201/file%201')
    expect(String(url)).toContain('remove=true')
  })
})

describe('purgeDownloadedSourceFiles', () => {
  const roots: string[] = []
  afterEach(async () => {
    await Promise.all(roots.splice(0).map(r => rm(r, { recursive: true, force: true })))
  })

  it('deletes matching source files and prunes the now-empty directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dmp-slskd-purge-'))
    roots.push(root)
    const peerDir = join(root, 'peer1')
    await mkdir(peerDir, { recursive: true })
    await writeFile(join(peerDir, 'Track.mp3'), 'x'.repeat(10))

    const removed = await purgeDownloadedSourceFiles(root, [{ filename: 'Track.mp3', size: 10 }])

    expect(removed).toBe(1)
    await expect(readFile(join(peerDir, 'Track.mp3'))).rejects.toThrow()
  })

  it('returns 0 without touching the filesystem when there is nothing to purge', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dmp-slskd-purge-'))
    roots.push(root)

    expect(await purgeDownloadedSourceFiles(root, [])).toBe(0)
  })
})
