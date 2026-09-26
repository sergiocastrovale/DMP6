import { prisma } from '~/server/utils/prisma'

// A number that changes whenever the library changes underneath us - the key ingredient that lets shared
// Redis caches outlive a TTL without going stale. Every lock-holding Rust script (index, sync, tidy, delete,
// nuke, ...) writes Statistics.updatedAt when it takes the scan lock, at checkpoints, and when it releases it
// (scripts/common/src/lock.rs, checkpoint.rs, statistics.rs). Those scripts can't reach Redis to bust keys
// themselves, so the web app reads their footprint instead: cache keys embed this version, and a rescan or
// merge makes every old key unreachable at once. Old entries simply age out by TTL - no SCAN, no DEL.
const VERSION_TTL_MS = 5_000

let cached: { value: number, at: number } | null = null
let inflight: Promise<number> | null = null

const load = async (): Promise<number> => {
  const row = await prisma.statistics.findUnique({ where: { id: 'main' }, select: { updatedAt: true } })
  return row?.updatedAt.getTime() ?? 0
}

export const libraryVersion = async (now: number = Date.now()): Promise<number> => {
  if (cached && now - cached.at < VERSION_TTL_MS) {
    return cached.value
  }
  // Concurrent callers share one query rather than each hitting the database.
  inflight ??= load()
    .then((value) => {
      cached = { value, at: now }
      return value
    })
    // A failed read must not wedge caching: serve the last known version (or 0) and retry next call.
    .catch(() => cached?.value ?? 0)
    .finally(() => {
      inflight = null
    })
  return inflight
}

export const _resetLibraryVersionForTest = (): void => {
  cached = null
  inflight = null
}
