import { prisma } from '~/server/utils/prisma'
import { invalidateCache } from '~/server/utils/cache'
import { recordPlay } from '~/server/utils/userPlays'

export interface PlayEventProgress {
  listenedSeconds: number
  counted: boolean
}

export interface ProgressPatch {
  listenedSeconds?: number
  counted?: boolean
}

// listenedSeconds only ever grows - a stale/out-of-order PATCH (network reorder, duplicate beacon)
// must never claw it back down. counted only ever flips false->true - once a listen has crossed the
// "meaningfully listened to" threshold (shouldScrobble, helpers/playerLogic.ts) it stays counted, even
// if a later patch omits the flag.
export function applyProgress(prev: PlayEventProgress, patch: ProgressPatch): PlayEventProgress {
  return {
    listenedSeconds: Math.max(prev.listenedSeconds, patch.listenedSeconds ?? 0),
    counted: prev.counted || !!patch.counted,
  }
}

export interface PlayEventPatchBody {
  listenedSeconds?: number
  counted?: boolean
  ended?: boolean
  skipped?: boolean
}

// Shared by the PATCH route and the sendBeacon-only finish route (beacon can only POST). Scoped to
// the caller's own event - anything else, or an unknown id, 404s rather than leaking which ids exist.
// The counted false->true transition is guarded by an `updateMany` on `counted: false`, so under two
// concurrent calls for the same event only the one that actually flips it runs recordPlay - the
// LocalReleaseTrackPlay increment this event feeds, and the last-played cache it invalidates.
export async function applyPlayEventPatch(userId: number, id: string, patch: PlayEventPatchBody) {
  const existing = await prisma.playEvent.findFirst({
    where: { id, userId },
    select: { trackId: true, listenedSeconds: true, counted: true },
  })
  if (!existing) {
    throw createError({ statusCode: 404, statusMessage: 'Play event not found' })
  }

  const next = applyProgress(existing, patch)
  const data: Record<string, unknown> = { listenedSeconds: next.listenedSeconds }
  if (patch.ended) {
    data.endedAt = new Date()
    data.skipped = !!patch.skipped
  }

  if (next.counted && !existing.counted) {
    const flipped = await prisma.playEvent.updateMany({
      where: { id, userId, counted: false },
      data: { ...data, counted: true },
    })
    if (flipped.count > 0) {
      await recordPlay(userId, existing.trackId, new Date())
      await invalidateCache(`releases:last-played:${userId}:*`)
      return { ok: true }
    }
    // Lost the race to another concurrent PATCH for the same event - it already flipped counted and
    // ran recordPlay, so just fall through to the ordinary update below for listenedSeconds/ended.
  }

  await prisma.playEvent.update({ where: { id }, data })
  return { ok: true }
}
