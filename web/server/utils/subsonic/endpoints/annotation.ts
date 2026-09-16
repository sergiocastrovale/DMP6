import type { H3Event } from 'h3'
import { isForeignKeyError } from '~/server/utils/prismaErrors'
import { starTrack, unstarTrack, starRelease, unstarRelease } from '~/server/utils/favorites'
import { recordExternalPlay } from '~/server/utils/playEvents'
import { SubsonicApiError, SubsonicErrorCode } from '~/server/utils/subsonic/errors'
import type { XmlObject } from '~/server/utils/subsonic/xml'
import type { HandlerContext } from '~/server/utils/subsonic/types'

const starTrackOrThrow = async (userId: number, trackId: string) => {
  try {
    await starTrack(userId, trackId)
  }
  catch (e) {
    if (isForeignKeyError(e)) {throw createError({ statusCode: 404, statusMessage: 'Track not found' })}
    throw e
  }
}

const starReleaseOrThrow = async (userId: number, releaseId: string) => {
  try {
    await starRelease(userId, releaseId)
  }
  catch (e) {
    if (isForeignKeyError(e)) {throw createError({ statusCode: 404, statusMessage: 'Album not found' })}
    throw e
  }
}

// artistId is intentionally ignored - DMP has no per-user FavoriteArtist (see mappers.ts's
// toArtist comment), only FavoriteRelease/FavoriteTrack.
export const star = async (_event: H3Event, ctx: HandlerContext): Promise<XmlObject> => {
  const trackIds = ctx.params.list('id')
  const albumIds = ctx.params.list('albumId')
  await Promise.all([
    ...trackIds.map(id => starTrackOrThrow(ctx.user.id, id)),
    ...albumIds.map(id => starReleaseOrThrow(ctx.user.id, id)),
  ])
  return {}
}

export const unstar = async (_event: H3Event, ctx: HandlerContext): Promise<XmlObject> => {
  const trackIds = ctx.params.list('id')
  const albumIds = ctx.params.list('albumId')
  await Promise.all([
    ...trackIds.map(id => unstarTrack(ctx.user.id, id)),
    ...albumIds.map(id => unstarRelease(ctx.user.id, id)),
  ])
  return {}
}

// submission=false (now-playing) is a no-op - DMP has no now-playing broadcast surface for
// external players to feed. submission=true (the default) synthesizes a finished PlayEvent per id.
export const scrobble = async (_event: H3Event, ctx: HandlerContext): Promise<XmlObject> => {
  const ids = ctx.params.list('id')
  if (!ids.length) {
    throw new SubsonicApiError(SubsonicErrorCode.MISSING_PARAM, "Missing required parameter 'id'")
  }
  const submission = ctx.params.bool('submission', true)
  if (submission) {
    for (const trackId of ids) {
      // Sequential, not Promise.all - each call increments the same user's LocalReleaseTrackPlay
      // counter and the log order (startedAt) should match the client's submitted id order.
      await recordExternalPlay(ctx.user.id, trackId)
    }
  }
  return {}
}
