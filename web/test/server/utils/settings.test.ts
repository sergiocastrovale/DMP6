import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const findUnique = vi.hoisted(() => vi.fn())

vi.mock('~/server/utils/prisma', () => ({ prisma: { settings: { findUnique } } }))

const settings = await import('../../../server/utils/settings')
const { getCachedSettings } = await import('../../../server/utils/settingsCache')

const row = (over: Record<string, unknown> = {}) => ({ id: 'main', musicDir: null, imageStorage: null, ...over })

describe('settings resolver', () => {
  beforeEach(() => {
    process.env.SETTINGS_CACHE_TTL_MS = '5000'
    delete process.env.MUSIC_DIR
    delete process.env.NUXT_MUSIC_DIR
    settings.resetSettingsForTests()
    findUnique.mockReset()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env.SETTINGS_CACHE_TTL_MS = '0'
  })

  it('serves repeated reads from one query inside the TTL and re-reads after it', async () => {
    findUnique.mockResolvedValue(row())
    await settings.getSettingsRow()
    await settings.getSettingsRow()
    expect(findUnique).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5_001)
    await settings.getSettingsRow()
    expect(findUnique).toHaveBeenCalledTimes(2)
  })

  it('shares one in-flight query between concurrent callers', async () => {
    findUnique.mockResolvedValue(row())
    await Promise.all([settings.getSettingsRow(), settings.getSettingsRow(), settings.getSettingsRow()])
    expect(findUnique).toHaveBeenCalledTimes(1)
  })

  it('reads again after an invalidation, and never caches a read that started before it', async () => {
    let release: (v: unknown) => void = () => {}
    findUnique.mockReturnValueOnce(new Promise((r) => { release = r }))
    const stale = settings.getSettingsRow()
    settings.invalidateSettings()
    findUnique.mockResolvedValueOnce(row({ musicDir: '/new' }))
    expect((await settings.getSettingsRow())?.musicDir).toBe('/new')
    release(row({ musicDir: '/old' }))
    await stale
    expect((await settings.getSettingsRow())?.musicDir).toBe('/new')
    expect(findUnique).toHaveBeenCalledTimes(2)
  })

  it('keeps serving the stale row when a reload fails, but a cold failure propagates', async () => {
    findUnique.mockRejectedValueOnce(new Error('down'))
    await expect(settings.getSettingsRow()).rejects.toThrow('down')
    findUnique.mockResolvedValueOnce(row({ musicDir: '/a' }))
    await settings.getSettingsRow()
    vi.advanceTimersByTime(6_000)
    findUnique.mockRejectedValueOnce(new Error('down'))
    expect((await settings.getSettingsRow())?.musicDir).toBe('/a')
  })

  it('resolveMusicDir: DB wins over env, env is the fallback', async () => {
    process.env.MUSIC_DIR = '/env'
    findUnique.mockResolvedValueOnce(row({ musicDir: '/db' }))
    expect(await settings.resolveMusicDir()).toBe('/db')
    findUnique.mockResolvedValueOnce(row())
    await settings.refreshSettings()
    expect(await settings.resolveMusicDir()).toBe('/env')
  })

  it('ensureSettingsLoaded waits for the first load and does not block forever when the DB is down', async () => {
    findUnique.mockRejectedValueOnce(new Error('down'))
    await expect(settings.ensureSettingsLoaded()).resolves.toBeUndefined()
    findUnique.mockClear()
    await settings.ensureSettingsLoaded()
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('getCachedSettings reflects the loaded row, and env values before any load', async () => {
    process.env.IMAGE_STORAGE = 's3'
    expect(getCachedSettings().imageStorage).toBe('s3')
    findUnique.mockResolvedValue(row({ imageStorage: 'local', musicDir: '/db' }))
    await settings.refreshSettings()
    expect(getCachedSettings()).toMatchObject({ imageStorage: 'local', musicDir: '/db' })
    delete process.env.IMAGE_STORAGE
  })
})
