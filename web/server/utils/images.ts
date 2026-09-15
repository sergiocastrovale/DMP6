import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getCachedSettings } from '~/server/utils/settingsCache'

let _imageDir: string | null = null

function getImageDir(): string {
  if (!_imageDir) {
    _imageDir = useRuntimeConfig().imageDir || './public/img'
  }
  return _imageDir
}

const existsCache = new Map<string, boolean>()
const CACHE_TTL = 60_000
let lastCacheClear = Date.now()

function cachedExists(filePath: string): boolean {
  const now = Date.now()
  if (now - lastCacheClear > CACHE_TTL) {
    existsCache.clear()
    lastCacheClear = now
  }
  const cached = existsCache.get(filePath)
  if (cached !== undefined) {return cached}
  const exists = existsSync(filePath)
  existsCache.set(filePath, exists)
  return exists
}

export function localImageExists(type: 'artists' | 'releases', filename: string): boolean {
  if (!filename) {return false}
  if (filename.includes('..') || filename.includes('/')) {return false}
  const filePath = resolve(join(getImageDir(), type, filename))
  return cachedExists(filePath)
}

// A file written after its `existsSync === false` result was cached (e.g. `./artist-photos --id`
// just downloaded it) would otherwise read as missing for up to CACHE_TTL - drop the entry so the
// very next verifyImage() call re-stats disk instead of trusting the stale negative.
export function forgetImageExists(type: 'artists' | 'releases', filename: string | null | undefined): void {
  if (!filename) {return}
  existsCache.delete(resolve(join(getImageDir(), type, filename)))
}

/**
 * Returns the image filename only if the file exists on disk (for local storage),
 * or returns it as-is when not in local mode.
 */
export function verifyImage(
  image: string | null | undefined,
  imageUrl: string | null | undefined,
  type: 'artists' | 'releases',
): { image: string | null; imageUrl: string | null } {
  const storage = getCachedSettings().imageStorage

  const validUrl = imageUrl || null
  let validImage: string | null = null

  const remoteServerUrl = useRuntimeConfig().remoteServerUrl

  if (image && (storage === 'local' || storage === 'both')) {
    validImage = localImageExists(type, image) ? image : (remoteServerUrl ? image : null)
  }
  else if (image) {
    validImage = image
  }

  return { image: validImage, imageUrl: validUrl }
}
