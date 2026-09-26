import type { PlaySource } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import { bumpUserCache } from '~/server/utils/cache'
import { recordPlay } from '~/server/utils/userPlays'
import { scrobbleInBackground } from '~/server/utils/scrobble'

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
//
// The whole read-modify-write runs in one transaction that holds a row lock on the event (`FOR UPDATE`), so
// concurrent patches for the same event queue up and each sees the previous one's committed state. That
// makes three things hold that the old read-then-write did not guarantee:
//   - listenedSeconds only ever grows: a slower patch carrying a smaller value can no longer overwrite a
//     larger one that landed first (the previous code raced exactly there);
//   - the counted false->true flip happens once, so LocalReleaseTrackPlay is incremented exactly once;
//   - the flip and the increment commit together - a crash between them can no longer leave a counted event
//     with no counter bump, which a replay could never repair (counted is already true).
export async function applyPlayEventPatch(userId: number, id: string, patch: PlayEventPatchBody) {
  const flipped = await prisma.$transaction(async (tx) => {
    const [existing] = await tx.$queryRaw<{ trackId: string, listenedSeconds: number, counted: boolean, startedAt: Date }[]>`
      SELECT "trackId", "listenedSeconds", counted, "startedAt" FROM "PlayEvent"
      WHERE id = ${id} AND "userId" = ${userId}
      FOR UPDATE`
    if (!existing) {
      throw createError({ statusCode: 404, statusMessage: 'Play event not found' })
    }

    const next = applyProgress(existing, patch)
    await tx.playEvent.update({
      where: { id },
      data: {
        listenedSeconds: next.listenedSeconds,
        counted: next.counted,
        ...(patch.ended ? { endedAt: new Date(), skipped: !!patch.skipped } : {}),
      },
    })

    const justCounted = next.counted && !existing.counted
    if (justCounted) {
      await recordPlay(userId, existing.trackId, new Date(), tx)
    }
    return justCounted ? { trackId: existing.trackId, startedAt: existing.startedAt } : null
  })

  if (flipped) {
    await bumpUserCache(userId)
    // Once per counted listen: the flip is the only place a play becomes counted, and it happens exactly once.
    scrobbleInBackground(flipped.trackId, flipped.startedAt.getTime())
  }
  return { ok: true }
}

// A scrobble from an external player (Subsonic clients - server/utils/subsonic/endpoints/
// annotation.ts) never opened a PlayEvent of its own via /api/play-events first, so this
// synthesizes one already-finished/counted event so it lands in stats/recap the same as a normal
// play, then folds it into the LocalReleaseTrackPlay counter the same way applyPlayEventPatch does -
// in one transaction, so the log and the counter can't disagree.
export async function recordExternalPlay(userId: number, trackId: string, source: PlaySource = 'SUBSONIC') {
  const track = await prisma.localReleaseTrack.findUnique({ where: { id: trackId }, select: { duration: true } })
  if (!track) {
    throw createError({ statusCode: 404, statusMessage: 'Track not found' })
  }

  const now = new Date()
  await prisma.$transaction(async (tx) => {
    await tx.playEvent.create({
      data: {
        userId,
        trackId,
        source,
        startedAt: now,
        endedAt: now,
        listenedSeconds: track.duration ?? 0,
        trackDuration: track.duration,
        counted: true,
      },
    })
    await recordPlay(userId, trackId, now, tx)
  })
  await bumpUserCache(userId)
  scrobbleInBackground(trackId, now.getTime())
}
