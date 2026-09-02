import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DownloadSearchResult } from '../../../types/download'

const slskdMocks = vi.hoisted(() => ({
  slskdSearch: vi.fn(),
  deleteSlskdSearch: vi.fn().mockResolvedValue(undefined),
  startSlskdDownload: vi.fn().mockResolvedValue(undefined),
}))
const downloadsMocks = vi.hoisted(() => ({ getSlskdResults: vi.fn() }))
const prismaMocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
}))
const settingsMocks = vi.hoisted(() => ({ resolveDownloadSettings: vi.fn() }))
const fsMocks = vi.hoisted(() => ({ mkdir: vi.fn().mockResolvedValue(undefined) }))

vi.mock('~/server/utils/slskd', () => slskdMocks)
vi.mock('~/server/utils/downloads', () => downloadsMocks)
vi.mock('~/server/utils/downloadSettings', () => settingsMocks)
vi.mock('~/server/utils/prisma', () => ({
  prisma: { downloadedRelease: { create: prismaMocks.create, update: prismaMocks.update } },
}))
vi.mock('node:fs/promises', () => ({ ...fsMocks, default: fsMocks }))

const { albumFolderMatches, findBestSlskdResult, acquireRelease } = await import('../../../server/utils/acquire')

describe('albumFolderMatches', () => {
  it('matches an exact (normalized) folder name', () => {
    expect(albumFolderMatches('/music/Some Artist/Diamonds Furcoat Champagne', 'Diamonds, Furcoat, Champagne')).toBe(true)
  })

  it('matches when the folder carries extra edition/format qualifiers', () => {
    expect(albumFolderMatches('Diamonds Furcoat Champagne (2008) [FLAC]', 'Diamonds, Furcoat, Champagne')).toBe(true)
  })

  it('matches on majority word overlap for near-matches', () => {
    expect(albumFolderMatches('Diamonds Furcoat and Champagne Remastered', 'Diamonds, Furcoat, Champagne')).toBe(true)
  })

  it('rejects a folder with no meaningful relation to the requested album', () => {
    expect(albumFolderMatches('Some Completely Unrelated Mixtape Vol 3', 'Diamonds, Furcoat, Champagne')).toBe(false)
  })

  it('rejects a different album by the same artist (short titles, no overlap)', () => {
    expect(albumFolderMatches('Wicked', 'Souls')).toBe(false)
  })

  it('never blocks on an empty/unknown album title', () => {
    expect(albumFolderMatches('anything at all', '')).toBe(true)
  })
})

const makeResult = (overrides: Partial<DownloadSearchResult> = {}): DownloadSearchResult => ({
  id: 'user:folder',
  source: 'slskd',
  username: 'user1',
  folderPath: 'Diamonds Furcoat Champagne',
  files: [{ filename: 'track.flac', size: 1000 }],
  fileCount: 1,
  totalSize: 1000,
  format: 'MP3',
  avgBitrate: 320,
  score: 50,
  hasFreeSlot: true,
  queueLength: 0,
  uploadSpeed: 100,
  ...overrides,
})

describe('findBestSlskdResult', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    slskdMocks.slskdSearch.mockResolvedValue('search-id')
    downloadsMocks.getSlskdResults.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const runToCompletion = async (promise: Promise<unknown>) => {
    for (let i = 0; i < 15; i++) {
      await vi.advanceTimersByTimeAsync(2000)
    }
    return promise
  }

  it('exits early once a FLAC result scores at or above 100', async () => {
    downloadsMocks.getSlskdResults.mockResolvedValue([
      makeResult({ format: 'FLAC', score: 120 }),
    ])

    const promise = findBestSlskdResult('Some Artist', 'Diamonds, Furcoat, Champagne')
    const best = await runToCompletion(promise)

    expect(best).toMatchObject({ format: 'FLAC', score: 120 })
    expect(downloadsMocks.getSlskdResults).toHaveBeenCalledTimes(1)
    expect(slskdMocks.deleteSlskdSearch).toHaveBeenCalledWith('search-id')
  })

  it('filters out results that do not plausibly match the requested album', async () => {
    downloadsMocks.getSlskdResults.mockResolvedValue([
      makeResult({ folderPath: 'Some Completely Unrelated Mixtape Vol 3', score: 999 }),
    ])

    const best = await runToCompletion(findBestSlskdResult('Some Artist', 'Diamonds, Furcoat, Champagne'))

    expect(best).toBeNull()
  })

  it('returns null when nothing ever matches', async () => {
    downloadsMocks.getSlskdResults.mockResolvedValue([])

    const best = await runToCompletion(findBestSlskdResult('Some Artist', 'Diamonds, Furcoat, Champagne'))

    expect(best).toBeNull()
    expect(downloadsMocks.getSlskdResults).toHaveBeenCalledTimes(15)
  })

  it('deletes the search even when polling throws', async () => {
    downloadsMocks.getSlskdResults.mockRejectedValue(new Error('boom'))

    const promise = findBestSlskdResult('Some Artist', 'Album')
    const expectation = expect(promise).rejects.toThrow('boom')
    await runToCompletion(promise.catch(() => {}))
    await expectation
    expect(slskdMocks.deleteSlskdSearch).toHaveBeenCalledWith('search-id')
  })
})

describe('acquireRelease', () => {
  beforeEach(() => {
    settingsMocks.resolveDownloadSettings.mockResolvedValue({ downloadsPath: '/downloads' })
    prismaMocks.create.mockReset().mockResolvedValue({ id: 'row-1' })
    prismaMocks.update.mockReset().mockResolvedValue({ id: 'row-1' })
    fsMocks.mkdir.mockClear()
    slskdMocks.startSlskdDownload.mockClear()
  })

  const baseParams = {
    albumTitle: 'Diamonds, Furcoat, Champagne',
    artistName: 'Some Artist',
    artistId: null,
    mbReleaseId: null,
    releaseGroupId: null,
    year: 2008,
    result: makeResult(),
  }

  it('throws when DOWNLOADS_PATH is not configured', async () => {
    settingsMocks.resolveDownloadSettings.mockResolvedValue({ downloadsPath: '' })

    await expect(acquireRelease(baseParams as any)).rejects.toThrow('DOWNLOADS_PATH not configured')
  })

  it('creates a new row, makes the artist folder, and starts the transfer', async () => {
    const result = await acquireRelease(baseParams as any)

    expect(result).toEqual({ id: 'row-1' })
    expect(prismaMocks.create).toHaveBeenCalledOnce()
    expect(prismaMocks.update).not.toHaveBeenCalled()
    expect(fsMocks.mkdir).toHaveBeenCalledWith('/downloads/Some Artist', { recursive: true })
    expect(slskdMocks.startSlskdDownload).toHaveBeenCalledWith('user1', [{ filename: 'track.flac', size: 1000 }])
  })

  it('updates the existing row when an id is supplied', async () => {
    await acquireRelease(baseParams as any, 'row-1')

    expect(prismaMocks.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'row-1' } }))
    expect(prismaMocks.create).not.toHaveBeenCalled()
  })
})
