import { describe, expect, it, vi } from 'vitest'
import type { SlskdSearchResponse, SlskdTransfer } from '../../../types/download'

const slskdMocks = vi.hoisted(() => ({
  checkSlskdConnection: vi.fn(),
  getSlskdSearchResults: vi.fn(),
  getSlskdActiveDownloads: vi.fn(),
  cancelSlskdDownload: vi.fn(),
}))

vi.mock('~/server/utils/slskd', async () => {
  const actual = await vi.importActual<typeof import('../../../server/utils/slskd')>('../../../server/utils/slskd')
  return {
    ...actual,
    checkSlskdConnection: slskdMocks.checkSlskdConnection,
    getSlskdSearchResults: slskdMocks.getSlskdSearchResults,
    getSlskdActiveDownloads: slskdMocks.getSlskdActiveDownloads,
    cancelSlskdDownload: slskdMocks.cancelSlskdDownload,
  }
})

vi.mock('~/server/utils/prowlarr', () => ({
  checkProwlarrConnection: vi.fn(),
}))

vi.mock('~/server/utils/qbittorrent', () => ({
  checkQbittorrentConnection: vi.fn(),
}))

const { checkProwlarrConnection } = await import('~/server/utils/prowlarr')
const { checkQbittorrentConnection } = await import('~/server/utils/qbittorrent')
const {
  getDownloadStatus,
  getSlskdResults,
  getAllActiveDownloads,
  cancelDownloadBySource,
} = await import('../../../server/utils/downloads')

describe('getDownloadStatus', () => {
  it('marks a connected source as configured and connected', async () => {
    slskdMocks.checkSlskdConnection.mockResolvedValue({ ok: true })
    vi.mocked(checkProwlarrConnection).mockResolvedValue({ ok: true })
    vi.mocked(checkQbittorrentConnection).mockResolvedValue({ ok: true })

    const status = await getDownloadStatus()

    expect(status.slskd).toEqual({ configured: true, connected: true, error: undefined })
  })

  it('treats a non-"not configured" error as configured but disconnected', async () => {
    slskdMocks.checkSlskdConnection.mockResolvedValue({ ok: false, error: 'Connection failed' })
    vi.mocked(checkProwlarrConnection).mockResolvedValue({ ok: true })
    vi.mocked(checkQbittorrentConnection).mockResolvedValue({ ok: true })

    const status = await getDownloadStatus()

    expect(status.slskd).toEqual({ configured: true, connected: false, error: 'Connection failed' })
  })

  it('treats a "not configured" error as unconfigured', async () => {
    slskdMocks.checkSlskdConnection.mockResolvedValue({ ok: false, error: 'slskd is not configured' })
    vi.mocked(checkProwlarrConnection).mockResolvedValue({ ok: true })
    vi.mocked(checkQbittorrentConnection).mockResolvedValue({ ok: true })

    const status = await getDownloadStatus()

    expect(status.slskd).toEqual({ configured: false, connected: false, error: 'slskd is not configured' })
  })

  it('swallows a rejected connection check as a generic failure', async () => {
    slskdMocks.checkSlskdConnection.mockRejectedValue(new Error('boom'))
    vi.mocked(checkProwlarrConnection).mockResolvedValue({ ok: true })
    vi.mocked(checkQbittorrentConnection).mockResolvedValue({ ok: true })

    const status = await getDownloadStatus()

    expect(status.slskd).toEqual({ configured: true, connected: false, error: 'Connection failed' })
  })
})

const makeResponse = (overrides: Partial<SlskdSearchResponse> = {}): SlskdSearchResponse => ({
  username: 'user1',
  fileCount: 2,
  freeUploadSlots: 1,
  uploadSpeed: 500,
  queueLength: 0,
  files: [
    { filename: 'Artist/Album/01 Track.flac', size: 1000, bitRate: 1000 },
    { filename: 'Artist/Album/02 Track.flac', size: 2000, bitRate: 1000 },
  ],
  ...overrides,
})

describe('getSlskdResults', () => {
  it('groups files by directory and picks the dominant format', async () => {
    slskdMocks.getSlskdSearchResults.mockResolvedValue([makeResponse()])

    const results = await getSlskdResults('search-1')

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      id: 'user1:Artist/Album',
      folderPath: 'Artist/Album',
      fileCount: 2,
      format: 'FLAC',
      avgBitrate: 1000,
      totalSize: 3000,
      hasFreeSlot: true,
    })
  })

  it('drops non-audio files entirely and skips a response left with none', async () => {
    slskdMocks.getSlskdSearchResults.mockResolvedValue([
      makeResponse({ files: [{ filename: 'Artist/Album/cover.jpg', size: 500 }] }),
    ])

    const results = await getSlskdResults('search-1')

    expect(results).toEqual([])
  })

  it('filters out results whose dominant format is not in the allow-list', async () => {
    slskdMocks.getSlskdSearchResults.mockResolvedValue([makeResponse()])

    const results = await getSlskdResults('search-1', 'mp3,ogg')

    expect(results).toEqual([])
  })

  it('keeps a result matching the allow-list, case-insensitively', async () => {
    slskdMocks.getSlskdSearchResults.mockResolvedValue([makeResponse()])

    const results = await getSlskdResults('search-1', 'FLAC')

    expect(results).toHaveLength(1)
  })

  it('filters out results below the minimum bitrate', async () => {
    slskdMocks.getSlskdSearchResults.mockResolvedValue([makeResponse()])

    const results = await getSlskdResults('search-1', undefined, 2000)

    expect(results).toEqual([])
  })

  it('sorts results with a free upload slot first, then by upload speed', async () => {
    slskdMocks.getSlskdSearchResults.mockResolvedValue([
      makeResponse({ username: 'slow-but-free', freeUploadSlots: 1, uploadSpeed: 100 }),
      makeResponse({ username: 'fast-but-busy', freeUploadSlots: 0, uploadSpeed: 900 }),
      makeResponse({ username: 'fast-and-free', freeUploadSlots: 1, uploadSpeed: 900 }),
    ])

    const results = await getSlskdResults('search-1')

    expect(results.map(r => r.username)).toEqual(['fast-and-free', 'slow-but-free', 'fast-but-busy'])
  })
})

describe('getAllActiveDownloads', () => {
  it('maps slskd transfers to the shared ActiveDownload shape', async () => {
    const transfer: SlskdTransfer = {
      id: 't1',
      username: 'user1',
      filename: 'Artist/Album/01 Track.flac',
      size: 1000,
      state: 'InProgress',
      bytesTransferred: 500,
      percentComplete: 50,
      averageSpeed: 200,
    }
    slskdMocks.getSlskdActiveDownloads.mockResolvedValue([transfer])

    const downloads = await getAllActiveDownloads()

    expect(downloads).toEqual([{ ...transfer, source: 'slskd' }])
  })

  it('returns an empty list when the slskd call rejects', async () => {
    slskdMocks.getSlskdActiveDownloads.mockRejectedValue(new Error('boom'))

    const downloads = await getAllActiveDownloads()

    expect(downloads).toEqual([])
  })
})

describe('cancelDownloadBySource', () => {
  it('delegates to the slskd cancel call', async () => {
    slskdMocks.cancelSlskdDownload.mockResolvedValue(undefined)

    await cancelDownloadBySource('user1', 't1')

    expect(slskdMocks.cancelSlskdDownload).toHaveBeenCalledWith('user1', 't1')
  })
})
