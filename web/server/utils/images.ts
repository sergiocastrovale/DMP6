import { existsSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { getCachedSettings } from '~/server/utils/settingsCache'

let _imageDir: string | null = null

const getImageDir = (): string => {
  if (!_imageDir) {
    _imageDir = useRuntimeConfig().imageDir || './public/img'
  }
  return _imageDir
}

// Existence of local image files. A bounded map with a per-entry TTL (the oldest entry goes when it is full),
// so expiry is spread out instead of a global clear every minute followed by a burst of stat calls.
const EXISTS_TTL_MS = 60_000
const EXISTS_MAX_ENTRIES = 20_000
const existsCache = new Map<string, { exists: boolean, at: number }>()

const remember = (filePath: string, exists: boolean): void => {
  existsCache.delete(filePath)
  existsCache.set(filePath, { exists, at: Date.now() })
  if (existsCache.size > EXISTS_MAX_ENTRIES) {
    const oldest = existsCache.keys().next().value
    if (oldest !== undefined) {
      existsCache.delete(oldest)
    }
  }
}

const freshEntry = (filePath: string): { exists: boolean, at: number } | undefined => {
  const entry = existsCache.get(filePath)
  return entry && Date.now() - entry.at < EXISTS_TTL_MS ? entry : undefined
}

// Synchronous fallback for a path nobody primed. Lists prime first (primeImageExistence), so on the hot paths this
// only ever answers from the cache; a lone lookup (a single release card) costs one stat.
const cachedExists = (filePath: string): boolean => {
  const entry = freshEntry(filePath)
  if (entry) {return entry.exists}
  const exists = existsSync(filePath)
  remember(filePath, exists)
  return exists
}

const imagePath = (type: 'artists' | 'releases', filename: string): string => resolve(join(getImageDir(), type, filename))

// Checks a whole list's image files at once without blocking the event loop, so the synchronous verifyImage() calls
// that follow all hit the cache. Only relevant when images are served from local disk.
export const primeImageExistence = async (
  type: 'artists' | 'releases',
  filenames: (string | null | undefined)[],
): Promise<void> => {
  const storage = getCachedSettings().imageStorage
  if (storage !== 'local' && storage !== 'both') {return}
  const pending = new Set<string>()
  for (const filename of filenames) {
    if (!filename || filename.includes('..') || filename.includes('/')) {continue}
    const filePath = imagePath(type, filename)
    if (!freshEntry(filePath)) {pending.add(filePath)}
  }
  await Promise.all([...pending].map(async (filePath) => {
    remember(filePath, await access(filePath).then(() => true, () => false))
  }))
}

export const localImageExists = (type: 'artists' | 'releases', filename: string): boolean => {
  if (!filename) {return false}
  if (filename.includes('..') || filename.includes('/')) {return false}
  return cachedExists(imagePath(type, filename))
}

// A file written after its `existsSync === false` result was cached (e.g. `./artist-photos --id`
// just downloaded it) would otherwise read as missing for up to CACHE_TTL - drop the entry so the
// very next verifyImage() call re-stats disk instead of trusting the stale negative.
export const forgetImageExists = (type: 'artists' | 'releases', filename: string | null | undefined): void => {
  if (!filename) {return}
  existsCache.delete(imagePath(type, filename))
}

/**
 * Returns the image filename only if the file exists on disk (for local storage),
 * or returns it as-is when not in local mode.
 */
export const verifyImage = (
  image: string | null | undefined,
  imageUrl: string | null | undefined,
  type: 'artists' | 'releases',
): { image: string | null; imageUrl: string | null } => {
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
