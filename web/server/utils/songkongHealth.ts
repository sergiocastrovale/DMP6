import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { songkongDirs, songkongMaxWaitMin, resolveSongkongEnabled, SONGKONG_STALE_AFTER_MIN } from '~/server/utils/songkongSettings'

/**
 * Liveness of the host SongKong drainer, read from the shared spool directory rather than from
 * monitorLoop's in-memory `lastSongkongDrainAt`: the filesystem is the same truth on every instance
 * and survives a container restart, and it answers the question the UI actually needs — "is anything
 * consuming the spool?" `songkong-drain.sh` deletes `spool/<id>` on success, so a spool entry older
 * than the staleness window means the cron is disabled, misconfigured or dead.
 *
 * This is the failure the downloads page had no way to explain: rows sat in ENRICHING with no hint
 * that the thing meant to drain them was never running.
 */
export interface SongkongHealth {
  /** Enrichment is switched on (DB setting wins over SONGKONG_ENABLED). */
  enabled: boolean
  /** Albums spooled and not yet enriched. */
  spoolCount: number
  /** Age of the oldest spool entry, minutes. Null when the spool is empty/unreadable. */
  oldestSpoolMin: number | null
  /** Nothing has consumed the spool for at least SONGKONG_STALE_AFTER_MIN. */
  stalled: boolean
  /** How long a row waits before it merges unenriched anyway. */
  maxWaitMin: number
}

/** Pure rule, so the staleness threshold is testable without a filesystem. */
export const isDrainerStalled = (oldestSpoolMin: number | null): boolean =>
  oldestSpoolMin !== null && oldestSpoolMin >= SONGKONG_STALE_AFTER_MIN

/** Oldest entry's age in minutes, or null when the directory is empty or unreadable. */
const oldestSpoolAgeMin = async (spoolDir: string, now: number): Promise<number | null> => {
  const names = await readdir(spoolDir).catch(() => null)
  if (!names?.length) {
    return null
  }
  const times = await Promise.all(
    names.map(name => stat(join(spoolDir, name)).then(s => s.mtimeMs).catch(() => null)),
  )
  const known = times.filter((t): t is number => t !== null)
  return known.length ? (now - Math.min(...known)) / 60_000 : null
}

export const readSongkongHealth = async (): Promise<SongkongHealth> => {
  const { spool } = songkongDirs()
  const enabled = await resolveSongkongEnabled().catch(() => false)
  const names = await readdir(spool).catch(() => [] as string[])
  const oldest = await oldestSpoolAgeMin(spool, Date.now())
  return {
    enabled,
    spoolCount: names.length,
    oldestSpoolMin: oldest === null ? null : Math.round(oldest),
    stalled: isDrainerStalled(oldest),
    maxWaitMin: songkongMaxWaitMin(),
  }
}
