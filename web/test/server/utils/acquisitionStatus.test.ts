import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  queryRaw: vi.fn(),
}))

vi.mock('~/server/utils/prisma', () => ({
  prisma: {
    settings: {
      findUnique: prismaMocks.findUnique,
    },
    $queryRaw: prismaMocks.queryRaw,
  },
}))

// getAcquisitionStatus is only about the DB-driven enabled/noYearMissing logic here — the physical
// environment probe (mounted volumes, ffmpeg, slskd) has its own coverage in
// downloadEnvironment.test.ts, so stub it to a fixed "healthy" reading.
const ok = { ok: true, detail: null }
const healthyEnv = { downloadsPath: ok, readyPath: ok, musicDir: ok, ffmpeg: ok, ffmpegRequired: true, slskd: ok }
vi.mock('~/server/utils/downloadEnvironment', () => ({
  checkDownloadEnvironment: vi.fn().mockResolvedValue(healthyEnv),
  acquireBlockReasons: () => [],
}))

const { isDownloadsEnabled, listNoYearMissing, getAcquisitionStatus, cachedNoYearMissing, _resetNoYearCacheForTest } = await import('../../../server/utils/acquisitionStatus')

describe('isDownloadsEnabled', () => {
  const originalEnv = process.env.DOWNLOADS_ENABLED

  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.DOWNLOADS_ENABLED
  })

  afterEach(() => {
    if (originalEnv === undefined) {delete process.env.DOWNLOADS_ENABLED}
    else {process.env.DOWNLOADS_ENABLED = originalEnv}
  })

  it('is true when Settings.downloadsEnabled is null and DOWNLOADS_ENABLED is unset (default)', async () => {
    prismaMocks.findUnique.mockResolvedValue({ downloadsEnabled: null })
    expect(await isDownloadsEnabled()).toBe(true)
  })

  it('falls back to DOWNLOADS_ENABLED=false when the DB value is null', async () => {
    process.env.DOWNLOADS_ENABLED = 'false'
    prismaMocks.findUnique.mockResolvedValue({ downloadsEnabled: null })
    expect(await isDownloadsEnabled()).toBe(false)
  })

  it('DB value wins over DOWNLOADS_ENABLED when explicitly set', async () => {
    process.env.DOWNLOADS_ENABLED = 'false'
    prismaMocks.findUnique.mockResolvedValue({ downloadsEnabled: true })
    expect(await isDownloadsEnabled()).toBe(true)
  })

  it('is true when Settings.downloadsEnabled is explicitly true', async () => {
    prismaMocks.findUnique.mockResolvedValue({ downloadsEnabled: true })
    expect(await isDownloadsEnabled()).toBe(true)
  })

  it('is false when Settings.downloadsEnabled is explicitly false', async () => {
    prismaMocks.findUnique.mockResolvedValue({ downloadsEnabled: false })
    expect(await isDownloadsEnabled()).toBe(false)
  })

  it('defaults to true when the Settings row is missing or the read throws', async () => {
    prismaMocks.findUnique.mockResolvedValue(null)
    expect(await isDownloadsEnabled()).toBe(true)

    prismaMocks.findUnique.mockRejectedValue(new Error('db down'))
    expect(await isDownloadsEnabled()).toBe(true)
  })
})

describe('listNoYearMissing', () => {
  it('returns the raw query rows', async () => {
    prismaMocks.queryRaw.mockResolvedValue([{ artist: 'Artist A', title: 'Release A' }])
    expect(await listNoYearMissing()).toEqual([{ artist: 'Artist A', title: 'Release A' }])
  })

  it('returns an empty list when the query yields no rows', async () => {
    prismaMocks.queryRaw.mockResolvedValue([])
    expect(await listNoYearMissing()).toEqual([])
  })
})

describe('getAcquisitionStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetNoYearCacheForTest()
  })

  it('summarizes acquisition eligibility when downloads are enabled', async () => {
    prismaMocks.findUnique.mockResolvedValue({ downloadsEnabled: true })
    const releases = [{ artist: 'Artist A', title: 'Release A' }, { artist: 'Artist B', title: 'Release B' }]
    prismaMocks.queryRaw.mockResolvedValue(releases)

    const status = await getAcquisitionStatus()

    expect(status).toEqual({ canAcquire: true, enabled: true, noYearMissing: 2, noYearMissingReleases: releases, environment: healthyEnv })
  })

  it('is not acquirable when downloads are disabled', async () => {
    prismaMocks.findUnique.mockResolvedValue({ downloadsEnabled: false })
    prismaMocks.queryRaw.mockRejectedValue(new Error('db down'))

    const status = await getAcquisitionStatus()

    expect(status).toEqual({ canAcquire: false, enabled: false, noYearMissing: 0, noYearMissingReleases: [], environment: healthyEnv })
  })
})

describe('cachedNoYearMissing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetNoYearCacheForTest()
  })

  it('runs the heavy query once per 5 minutes, however often the queue is polled', async () => {
    const sevenReleases = Array.from({ length: 7 }, (_, i) => ({ artist: `Artist ${i}`, title: `Release ${i}` }))
    prismaMocks.queryRaw.mockResolvedValue(sevenReleases)

    expect(await cachedNoYearMissing(1_000)).toEqual(sevenReleases)
    expect(await cachedNoYearMissing(60_000)).toEqual(sevenReleases)
    expect(await cachedNoYearMissing(299_000)).toEqual(sevenReleases)
    expect(prismaMocks.queryRaw).toHaveBeenCalledTimes(1)

    const nineReleases = Array.from({ length: 9 }, (_, i) => ({ artist: `Artist ${i}`, title: `Release ${i}` }))
    prismaMocks.queryRaw.mockResolvedValue(nineReleases)
    expect(await cachedNoYearMissing(302_000)).toEqual(nineReleases)
    expect(prismaMocks.queryRaw).toHaveBeenCalledTimes(2)
  })

  it('keeps serving the last value when a refresh fails instead of flashing empty', async () => {
    const releases = [{ artist: 'Artist A', title: 'Release A' }]
    prismaMocks.queryRaw.mockResolvedValueOnce(releases).mockRejectedValueOnce(new Error('db down'))

    expect(await cachedNoYearMissing(1_000)).toEqual(releases)
    expect(await cachedNoYearMissing(400_000)).toEqual(releases)
  })
})
