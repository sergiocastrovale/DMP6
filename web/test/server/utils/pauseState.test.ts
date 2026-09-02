import { afterEach, describe, expect, it, vi } from 'vitest'
import { statfs } from 'node:fs/promises'

vi.mock('node:fs/promises', () => {
  const mocks = { statfs: vi.fn() }
  return { ...mocks, default: mocks }
})

const prismaMocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('~/server/utils/prisma', () => ({
  prisma: { settings: { findUnique: prismaMocks.findUnique, update: prismaMocks.update } },
}))

const monitorLogMock = vi.hoisted(() => vi.fn())
vi.mock('~/server/utils/monitorLog', () => ({ monitorLog: monitorLogMock }))

const {
  freeGb, getPauseState, isDownloadsPaused, setDownloadsPaused, enforceDiskGuard,
} = await import('../../../server/utils/pauseState')

afterEach(() => vi.clearAllMocks())

describe('freeGb', () => {
  it('computes free GB from bavail * bsize', async () => {
    vi.mocked(statfs).mockResolvedValue({ bavail: 1_000_000, bsize: 4096 } as any)

    expect(await freeGb('/downloads')).toBeCloseTo(4.096, 3)
  })

  it('returns -1 when the stat fails', async () => {
    vi.mocked(statfs).mockRejectedValue(new Error('ENOENT'))

    expect(await freeGb('/missing')).toBe(-1)
  })
})

describe('getPauseState / isDownloadsPaused', () => {
  it('defaults to not paused when settings row is missing', async () => {
    prismaMocks.findUnique.mockResolvedValue(null)

    expect(await getPauseState()).toEqual({ paused: false, reason: null })
    expect(await isDownloadsPaused()).toBe(false)
  })

  it('reflects the stored pause reason', async () => {
    prismaMocks.findUnique.mockResolvedValue({ downloadsPaused: true, downloadsPausedReason: 'disk-full' })

    expect(await getPauseState()).toEqual({ paused: true, reason: 'disk-full' })
    expect(await isDownloadsPaused()).toBe(true)
  })
})

describe('setDownloadsPaused', () => {
  it('clears the reason when unpausing', async () => {
    await setDownloadsPaused(false, null)

    expect(prismaMocks.update).toHaveBeenCalledWith({
      where: { id: 'main' },
      data: { downloadsPaused: false, downloadsPausedReason: null },
    })
  })

  it('swallows a failed update rather than throwing', async () => {
    prismaMocks.update.mockRejectedValueOnce(new Error('db down'))

    await expect(setDownloadsPaused(true, 'disk-full')).resolves.toBeUndefined()
  })
})

describe('enforceDiskGuard', () => {
  it('pauses and logs once when free space drops below the floor', async () => {
    vi.mocked(statfs).mockResolvedValue({ bavail: 1, bsize: 1 } as any)
    prismaMocks.findUnique.mockResolvedValue({ downloadsPaused: false, downloadsPausedReason: null })

    const paused = await enforceDiskGuard('/downloads', 10)

    expect(paused).toBe(true)
    expect(prismaMocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ downloadsPaused: true, downloadsPausedReason: 'disk-full' }) }))
    expect(monitorLogMock).toHaveBeenCalledOnce()
  })

  it('does not re-log when already paused for disk-full', async () => {
    vi.mocked(statfs).mockResolvedValue({ bavail: 1, bsize: 1 } as any)
    prismaMocks.findUnique.mockResolvedValue({ downloadsPaused: true, downloadsPausedReason: 'disk-full' })

    const paused = await enforceDiskGuard('/downloads', 10)

    expect(paused).toBe(true)
    expect(prismaMocks.update).not.toHaveBeenCalled()
    expect(monitorLogMock).not.toHaveBeenCalled()
  })

  it('returns the current pause state unchanged when space is fine', async () => {
    vi.mocked(statfs).mockResolvedValue({ bavail: 1_000_000_000, bsize: 4096 } as any)
    prismaMocks.findUnique.mockResolvedValue({ downloadsPaused: false, downloadsPausedReason: null })

    expect(await enforceDiskGuard('/downloads', 10)).toBe(false)
  })
})
