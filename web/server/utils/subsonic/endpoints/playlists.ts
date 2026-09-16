import type { H3Event } from 'h3'
import { prisma } from '~/server/utils/prisma'
import { generateSlug } from '~/server/utils/slug'
import { visiblePlaylistsWhere } from '~/server/utils/libraryOwnership'
import { trackPlaysByIds } from '~/server/utils/userPlays'
import { favoriteTrackDates } from '~/server/utils/favorites'
import { SONG_SELECT } from '~/server/utils/subsonic/select'
import { toSong } from '~/server/utils/subsonic/mappers'
import { SubsonicApiError, SubsonicErrorCode } from '~/server/utils/subsonic/errors'
import type { XmlObject } from '~/server/utils/subsonic/xml'
import type { HandlerContext } from '~/server/utils/subsonic/types'

const durationsByPlaylistId = async (playlistIds: string[]): Promise<Map<string, number>> => {
  if (!playlistIds.length) {return new Map()}
  const rows = await prisma.$queryRaw<{ playlistId: string, duration: bigint }[]>`
    SELECT pt."playlistId" AS "playlistId", COALESCE(SUM(t.duration), 0)::bigint AS duration
    FROM "PlaylistTrack" pt
    JOIN "LocalReleaseTrack" t ON t.id = pt."trackId"
    WHERE pt."playlistId" = ANY(${playlistIds}::text[])
    GROUP BY pt."playlistId"
  `
  return new Map(rows.map(r => [r.playlistId, Number(r.duration)]))
}

export const getPlaylists = async (_event: H3Event, ctx: HandlerContext): Promise<XmlObject> => {
  const playlists = await prisma.playlist.findMany({
    where: visiblePlaylistsWhere(ctx.user.id),
    include: { _count: { select: { tracks: true } } },
    orderBy: { createdAt: 'desc' },
  })
  const durations = await durationsByPlaylistId(playlists.map(p => p.id))

  return {
    playlists: {
      playlist: playlists.map(p => ({
        id: p.id,
        name: p.name,
        comment: p.description ?? undefined,
        songCount: p._count.tracks,
        duration: durations.get(p.id) ?? 0,
        createdDate: p.createdAt.toISOString(),
        changed: p.updatedAt.toISOString(),
        // GENRE/REGION playlists are shared/generated (userId null - see CLAUDE.md Data Model);
        // MANUAL ones are private to their owner. "public" here just distinguishes the two, not a
        // web-app sharing feature (DMP has none).
        public: p.userId === null,
      })),
    },
  }
}

// Shared by getPlaylist and createPlaylist's return value, so a freshly created playlist comes
// back in exactly the same shape a subsequent getPlaylist would report.
const loadPlaylistPayload = async (userId: number, id: string): Promise<XmlObject> => {
  const playlist = await prisma.playlist.findFirst({
    where: { id, ...visiblePlaylistsWhere(userId) },
    include: {
      _count: { select: { tracks: true } },
      tracks: { orderBy: { position: 'asc' }, select: { track: { select: SONG_SELECT } } },
    },
  })
  if (!playlist) {throw new SubsonicApiError(SubsonicErrorCode.NOT_FOUND, 'Playlist not found')}

  const songRows = playlist.tracks.map(t => t.track)
  const trackIds = songRows.map(s => s.id)
  const [plays, starred] = await Promise.all([
    trackPlaysByIds(userId, trackIds),
    favoriteTrackDates(userId, trackIds),
  ])
  const duration = songRows.reduce((sum, s) => sum + (s.duration ?? 0), 0)

  return {
    playlist: {
      id: playlist.id,
      name: playlist.name,
      comment: playlist.description ?? undefined,
      songCount: playlist._count.tracks,
      duration,
      createdDate: playlist.createdAt.toISOString(),
      changed: playlist.updatedAt.toISOString(),
      public: playlist.userId === null,
      entry: songRows.map(s => toSong(s, { plays, starred })),
    },
  }
}

export const getPlaylist = async (_event: H3Event, ctx: HandlerContext): Promise<XmlObject> =>
  loadPlaylistPayload(ctx.user.id, ctx.params.strRequired('id'))

// v1 only creates a brand-new playlist (name + optional songId[]) - updating an existing one's
// track list via createPlaylist's playlistId form (the Subsonic spec's alternate call shape) is a
// follow-up, along with a dedicated updatePlaylist endpoint; use the web app to edit one meanwhile.
export const createPlaylist = async (_event: H3Event, ctx: HandlerContext): Promise<XmlObject> => {
  const name = ctx.params.strRequired('name')
  const songIds = ctx.params.list('songId')

  const slug = generateSlug(name)
  if (!slug) {
    throw new SubsonicApiError(SubsonicErrorCode.GENERIC, 'Playlist name must contain at least one letter or number')
  }

  const existing = await prisma.playlist.findFirst({ where: { slug, ...visiblePlaylistsWhere(ctx.user.id) } })
  if (existing) {
    throw createError({ statusCode: 409, statusMessage: 'Playlist with this name already exists' })
  }

  const playlist = await prisma.playlist.create({ data: { name, slug, userId: ctx.user.id } })
  if (songIds.length) {
    await prisma.playlistTrack.createMany({
      data: songIds.map((trackId, i) => ({ playlistId: playlist.id, trackId, position: i })),
      skipDuplicates: true,
    })
  }

  return loadPlaylistPayload(ctx.user.id, playlist.id)
}

export const deletePlaylist = async (_event: H3Event, ctx: HandlerContext): Promise<XmlObject> => {
  const id = ctx.params.strRequired('id')
  // Scoped to the caller's own MANUAL playlists - userId is never null for a real row here, so a
  // shared GENRE/REGION playlist (userId null) 404s the same as someone else's, never a 403 that
  // would leak which ids exist for another user (same contract as findOwnManualPlaylist).
  const playlist = await prisma.playlist.findFirst({ where: { id, userId: ctx.user.id } })
  if (!playlist) {throw new SubsonicApiError(SubsonicErrorCode.NOT_FOUND, 'Playlist not found')}

  await prisma.playlist.delete({ where: { id: playlist.id } })
  return {}
}
