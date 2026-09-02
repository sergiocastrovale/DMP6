import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TorrentAcquireParams } from '../../../types/download'

const prismaMocks = vi.hoisted(() => ({ update: vi.fn().mockResolvedValue(undefined) }))
vi.mock('~/server/utils/prisma', () => ({
  prisma: { downloadedRelease: { update: prismaMocks.update } },
}))

const acquireMocks = vi.hoisted(() => ({
  findBestSlskdResult: vi.fn(),
  acquireRelease: vi.fn().mockResolvedValue({ id: 'row-1' }),
}))
vi.mock('~/server/utils/acquire', () => acquireMocks)

const torrentMocks = vi.hoisted(() => ({ acquireTorrentRelease: vi.fn() }))
vi.mock('~/server/utils/acquireTorrent', () => torrentMocks)

const sourcesMocks = vi.hoisted(() => ({ consumeRtBudget: vi.fn().mockResolvedValue(undefined) }))
vi.mock('~/server/utils/downloadSources', () => ({
  ...sourcesMocks,
  RT_PRIORITY: 10,
  SLSK_PRIORITY: 5,
}))

vi.mock('~/server/utils/downloadSettings', () => ({ resolveDownloadSettings: vi.fn() }))
vi.mock('~/server/utils/monitorSettings', () => ({ resolveMonitorSettings: vi.fn() }))
vi.mock('~/server/utils/prowlarr', () => ({ prowlarrRtLimited: vi.fn() }))
vi.mock('~/server/utils/pauseState', () => ({ isDownloadsPaused: vi.fn() }))
vi.mock('~/server/utils/monitorLog', () => ({ monitorLog: vi.fn() }))

const { routeAcquire, failRtMiss } = await import('../../../server/utils/autoDownload')

afterEach(() => vi.clearAllMocks())

const params: TorrentAcquireParams = {
  artistId: 'artist-1',
  artistName: 'Some Artist',
  albumTitle: 'Some Album',
  year: 2020,
  mbReleaseId: 'mb-1',
  releaseGroupId: 'rg-1',
}

describe('routeAcquire', () => {
  it('spends a RuTracker budget unit and reports a hit on success', async () => {
    torrentMocks.acquireTorrentRelease.mockResolvedValue({ ok: true })

    const hit = await routeAcquire('RUTRACKER', params, 'row-1', 'flac', null)

    expect(hit).toBe(true)
    expect(sourcesMocks.consumeRtBudget).toHaveBeenCalledOnce()
    expect(torrentMocks.acquireTorrentRelease).toHaveBeenCalledWith(params, 'row-1')
  })

  it('reports a miss when the RuTracker acquire throws', async () => {
    torrentMocks.acquireTorrentRelease.mockRejectedValue(new Error('no torrent'))

    const hit = await routeAcquire('RUTRACKER', params, 'row-1', 'flac', null)

    expect(hit).toBe(false)
  })

  it('searches and acquires via Soulseek, forwarding format/bitrate filters', async () => {
    acquireMocks.findBestSlskdResult.mockResolvedValue({ username: 'user1', files: [] })

    const hit = await routeAcquire('SLSKD', params, 'row-1', 'flac,mp3', 256)

    expect(hit).toBe(true)
    expect(acquireMocks.findBestSlskdResult).toHaveBeenCalledWith('Some Artist', 'Some Album', 'flac,mp3', 256)
    expect(acquireMocks.acquireRelease).toHaveBeenCalledWith(expect.objectContaining({ artistId: 'artist-1' }), 'row-1')
  })

  it('reports a miss when Soulseek finds nothing, without calling acquireRelease', async () => {
    acquireMocks.findBestSlskdResult.mockResolvedValue(null)

    const hit = await routeAcquire('SLSKD', params, 'row-1', '', null)

    expect(hit).toBe(false)
    expect(acquireMocks.acquireRelease).not.toHaveBeenCalled()
  })

  it('reports a miss when the Soulseek search itself throws', async () => {
    acquireMocks.findBestSlskdResult.mockRejectedValue(new Error('slskd down'))

    expect(await routeAcquire('SLSKD', params, 'row-1', '', null)).toBe(false)
  })
})

describe('failRtMiss', () => {
  it('bumps attempts, drops priority to the Soulseek band, and records the RuTracker miss', async () => {
    await failRtMiss('row-1', 2, 'no match')

    expect(prismaMocks.update).toHaveBeenCalledWith({
      where: { id: 'row-1' },
      data: {
        attempts: 3,
        priority: 5,
        status: 'UNAVAILABLE',
        triedSources: { push: 'RUTRACKER' },
        error: 'no match',
      },
    })
  })

  it('swallows a failed update rather than throwing', async () => {
    prismaMocks.update.mockRejectedValueOnce(new Error('db down'))

    await expect(failRtMiss('row-1', 0, 'no match')).resolves.toBeUndefined()
  })
})
