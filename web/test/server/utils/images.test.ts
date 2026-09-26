import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'dmp-img-'))
const settings = vi.hoisted(() => ({ imageStorage: 'local' }))

vi.stubGlobal('useRuntimeConfig', () => ({ imageDir: dir, remoteServerUrl: '' }))
vi.mock('~/server/utils/settingsCache', () => ({ getCachedSettings: () => settings }))

const images = await import('../../../server/utils/images')

describe('image existence cache', () => {
  beforeAll(() => {
    mkdirSync(join(dir, 'artists'), { recursive: true })
    writeFileSync(join(dir, 'artists', 'present.jpg'), 'x')
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  beforeEach(() => {
    settings.imageStorage = 'local'
    vi.useRealTimers()
  })

  it('verifyImage keeps a file that exists and drops one that does not', () => {
    expect(images.verifyImage('present.jpg', null, 'artists').image).toBe('present.jpg')
    expect(images.verifyImage('gone.jpg', null, 'artists').image).toBeNull()
  })

  it('primeImageExistence answers a whole list up front, so later lookups hit the cache', async () => {
    writeFileSync(join(dir, 'artists', 'late.jpg'), 'x')
    await images.primeImageExistence('artists', ['late.jpg', 'never.jpg', null, undefined, '../escape.jpg', 'a/b.jpg'])
    // The file vanishing after the prime does not change the cached answer inside the TTL.
    rmSync(join(dir, 'artists', 'late.jpg'))
    expect(images.verifyImage('late.jpg', null, 'artists').image).toBe('late.jpg')
    expect(images.verifyImage('never.jpg', null, 'artists').image).toBeNull()
  })

  it('a path traversal never reads as existing', () => {
    expect(images.localImageExists('artists', '../artists/present.jpg')).toBe(false)
    expect(images.localImageExists('artists', 'a/present.jpg')).toBe(false)
  })

  it('forgetImageExists drops a stale negative so a freshly written file is seen', async () => {
    await images.primeImageExistence('artists', ['fresh.jpg'])
    expect(images.localImageExists('artists', 'fresh.jpg')).toBe(false)
    writeFileSync(join(dir, 'artists', 'fresh.jpg'), 'x')
    expect(images.localImageExists('artists', 'fresh.jpg')).toBe(false)
    images.forgetImageExists('artists', 'fresh.jpg')
    expect(images.localImageExists('artists', 'fresh.jpg')).toBe(true)
  })

  it('an entry expires after its TTL and the disk is asked again', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    writeFileSync(join(dir, 'artists', 'ttl.jpg'), 'x')
    expect(images.localImageExists('artists', 'ttl.jpg')).toBe(true)
    rmSync(join(dir, 'artists', 'ttl.jpg'))
    vi.setSystemTime(new Date('2026-01-01T00:00:30Z'))
    expect(images.localImageExists('artists', 'ttl.jpg')).toBe(true)
    vi.setSystemTime(new Date('2026-01-01T00:01:01Z'))
    expect(images.localImageExists('artists', 'ttl.jpg')).toBe(false)
  })

  it('does nothing for remote storage', async () => {
    settings.imageStorage = 's3'
    await expect(images.primeImageExistence('artists', ['x.jpg'])).resolves.toBeUndefined()
    expect(images.verifyImage('x.jpg', null, 'artists').image).toBe('x.jpg')
  })
})
