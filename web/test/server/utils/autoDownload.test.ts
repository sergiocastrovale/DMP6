import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AcquisitionTarget } from '../../../types/download'

const acquireMocks = vi.hoisted(() => ({
  findBestSlskdResult: vi.fn(),
  acquireRelease: vi.fn().mockResolvedValue({ id: 'row-1' }),
}))
vi.mock('~/server/utils/acquire', () => acquireMocks)

vi.mock('~/server/utils/acquisitionStatus', () => ({ isDownloadsEnabled: vi.fn().mockResolvedValue(true) }))
vi.mock('~/server/utils/downloadSettings', () => ({ resolveDownloadSettings: vi.fn() }))
vi.mock('~/server/utils/monitorSettings', () => ({ resolveMonitorSettings: vi.fn() }))
vi.mock('~/server/utils/pauseState', () => ({ isDownloadsPaused: vi.fn() }))
vi.mock('~/server/utils/monitorLog', () => ({ monitorLog: vi.fn() }))

const { routeAcquire } = await import('../../../server/utils/autoDownload')

afterEach(() => vi.clearAllMocks())

const params: AcquisitionTarget = {
  artistId: 'artist-1',
  artistName: 'Some Artist',
  albumTitle: 'Some Album',
  year: 2020,
  mbReleaseId: 'mb-1',
  releaseGroupId: 'rg-1',
}

describe('routeAcquire', () => {
  it('searches and acquires via Soulseek, forwarding format/bitrate filters', async () => {
    acquireMocks.findBestSlskdResult.mockResolvedValue({ username: 'user1', files: [] })

    const hit = await routeAcquire(params, 'row-1', 'flac,mp3', 256)

    expect(hit).toBe(true)
    expect(acquireMocks.findBestSlskdResult).toHaveBeenCalledWith('Some Artist', 'Some Album', 'flac,mp3', 256)
    expect(acquireMocks.acquireRelease).toHaveBeenCalledWith(expect.objectContaining({ artistId: 'artist-1' }), 'row-1')
  })

  it('reports a miss when Soulseek finds nothing, without calling acquireRelease', async () => {
    acquireMocks.findBestSlskdResult.mockResolvedValue(null)

    const hit = await routeAcquire(params, 'row-1', '', null)

    expect(hit).toBe(false)
    expect(acquireMocks.acquireRelease).not.toHaveBeenCalled()
  })

  it('reports a miss when the Soulseek search itself throws', async () => {
    acquireMocks.findBestSlskdResult.mockRejectedValue(new Error('slskd down'))

    expect(await routeAcquire(params, 'row-1', '', null)).toBe(false)
  })
})
