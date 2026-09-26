import type { Settings } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'

// The one place the `Settings` row is read. Every resolver (settingsCache, downloadSettings, monitorSettings,
// autoScan, songkongSettings, pauseState, acquisitionStatus) derives its DB → env → default view from this row,
// so the 5s monitor tick costs one query instead of eight to twelve.

const DEFAULT_TTL_MS = 5_000

// Tests upsert the row straight into the DB and expect the next read to see it, so they run with 0.
const ttlMs = (): number => {
  const raw = Number(process.env.SETTINGS_CACHE_TTL_MS)
  return process.env.SETTINGS_CACHE_TTL_MS !== undefined && Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_TTL_MS
}

// `undefined` = never loaded, `null` = loaded and there is no row yet.
let row: Settings | null | undefined
let expiresAt = 0
let inflight: Promise<Settings | null> | null = null
let loadAttempted = false

const load = (): Promise<Settings | null> => {
  if (!inflight) {
    const started = prisma.settings.findUnique({ where: { id: 'main' } })
      .then((r) => {
        // An invalidation while this read was in flight orphaned it (inflight was reset): its result may
        // predate the write that triggered the invalidation.
        if (inflight === started) {
          row = r
          expiresAt = Date.now() + ttlMs()
        }
        return r
      })
      .catch((e) => {
        // A stale row beats an error for a background loop; only a cold failure propagates.
        if (row !== undefined) {
          return row
        }
        throw e
      })
      .finally(() => {
        loadAttempted = true
        if (inflight === started) {
          inflight = null
        }
      })
    inflight = started
  }
  return inflight
}

export const getSettingsRow = async ({ fresh = false }: { fresh?: boolean } = {}): Promise<Settings | null> => {
  if (fresh) {
    invalidateSettings()
  }
  return row !== undefined && Date.now() < expiresAt ? row : load()
}

// The last loaded row without touching the database - for the synchronous readers (serveTrack, image URLs).
// `undefined` only before the first successful load.
export const peekSettingsRow = (): Settings | null | undefined => row

export const settingsStale = (): boolean => row === undefined || Date.now() >= expiresAt

// Marks the row stale; the previous value stays readable until the next load lands.
export const invalidateSettings = (): void => {
  expiresAt = 0
  inflight = null
}

export const refreshSettings = async (): Promise<Settings | null> => {
  invalidateSettings()
  return load()
}

// Resolves once a first load has been attempted (success or not), so the first requests after a restart
// never see env defaults in place of the DB values. A DB that is down at boot must not block requests forever.
export const ensureSettingsLoaded = async (): Promise<void> => {
  if (loadAttempted) {
    return
  }
  await load().catch(() => null)
}

export const envMusicDir = (): string => process.env.MUSIC_DIR || process.env.NUXT_MUSIC_DIR || ''

// The library root: the DB value wins over the environment, for merges, the environment probe and playback alike.
export const resolveMusicDir = async (): Promise<string> => (await getSettingsRow().catch(() => null))?.musicDir || envMusicDir()

// Test seam: forget everything, as a fresh process would.
export const resetSettingsForTests = (): void => {
  row = undefined
  expiresAt = 0
  inflight = null
  loadAttempted = false
}
