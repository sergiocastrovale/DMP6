import type { H3Event } from 'h3'
import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import { serveLocalImage } from '~/server/utils/serveImage'
import { serveTrackFile } from '~/server/utils/serveTrack'
import { SubsonicApiError, SubsonicErrorCode } from '~/server/utils/subsonic/errors'
import { parseCoverArtId } from '~/server/utils/subsonic/ids'
import type { HandlerContext } from '~/server/utils/subsonic/types'

export const stream = async (event: H3Event, ctx: HandlerContext) => {
  const id = ctx.params.strRequired('id')
  return serveTrackFile(event, id)
}

export const download = async (event: H3Event, ctx: HandlerContext) => {
  const id = ctx.params.strRequired('id')
  return serveTrackFile(event, id, { download: true })
}

const resolveCoverArt = async (
  event: H3Event,
  image: string | null,
  imageUrl: string | null,
  type: 'artists' | 'releases',
) => {
  const verified = verifyImage(image, imageUrl, type)
  // Prefer a local file when one exists (no extra proxy hop); fall back to the S3/CDN URL
  // otherwise - mirrors how useImageUrl.ts resolves the same pair client-side.
  if (verified.image) {
    return serveLocalImage(event, type, verified.image)
  }
  if (verified.imageUrl) {
    return sendRedirect(event, verified.imageUrl)
  }
  throw new SubsonicApiError(SubsonicErrorCode.NOT_FOUND, 'No cover art')
}

export const getCoverArt = async (event: H3Event, ctx: HandlerContext) => {
  const id = ctx.params.strRequired('id')
  const ref = parseCoverArtId(id)
  if (!ref) {throw new SubsonicApiError(SubsonicErrorCode.NOT_FOUND, 'Unknown cover art id')}

  if (ref.type === 'artist') {
    const artist = await prisma.artist.findUnique({ where: { id: ref.id }, select: { image: true, imageUrl: true } })
    if (!artist) {throw new SubsonicApiError(SubsonicErrorCode.NOT_FOUND, 'Artist not found')}
    return resolveCoverArt(event, artist.image, artist.imageUrl, 'artists')
  }

  if (ref.type === 'album') {
    const release = await prisma.localRelease.findUnique({ where: { id: ref.id }, select: { image: true, imageUrl: true } })
    if (!release) {throw new SubsonicApiError(SubsonicErrorCode.NOT_FOUND, 'Album not found')}
    return resolveCoverArt(event, release.image, release.imageUrl, 'releases')
  }

  // A playlist cover art request must not leak whether a private playlist id belonging to another
  // user exists - confirm visibility first (same rule as getPlaylist).
  const playlist = await prisma.playlist.findFirst({
    where: { id: ref.id, OR: [{ userId: ctx.user.id }, { userId: null }] },
    select: { id: true },
  })
  if (!playlist) {throw new SubsonicApiError(SubsonicErrorCode.NOT_FOUND, 'Playlist not found')}

  // Playlist cover art: mosaic of first-4-track covers is a web-only affordance (Playlist.vue) -
  // Subsonic wants one cover per playlist id, so use its first track's release image.
  const firstTrack = await prisma.playlistTrack.findFirst({
    where: { playlistId: playlist.id },
    orderBy: { position: 'asc' },
    select: { track: { select: { localRelease: { select: { image: true, imageUrl: true } } } } },
  })
  const release = firstTrack?.track.localRelease
  if (!release) {throw new SubsonicApiError(SubsonicErrorCode.NOT_FOUND, 'No cover art for playlist')}
  return resolveCoverArt(event, release.image, release.imageUrl, 'releases')
}
