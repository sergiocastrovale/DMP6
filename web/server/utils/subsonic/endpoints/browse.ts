import type { H3Event } from 'h3'
import { prisma } from '~/server/utils/prisma'
import { releasePlayTotals, trackPlaysByIds } from '~/server/utils/userPlays'
import { favoriteReleaseDates, favoriteTrackDates } from '~/server/utils/favorites'
import { SubsonicApiError, SubsonicErrorCode } from '~/server/utils/subsonic/errors'
import { subsonicArtistWhere, subsonicAlbumWhere } from '~/server/utils/subsonic/scope'
import { ARTIST_SELECT, ALBUM_SELECT, SONG_SELECT } from '~/server/utils/subsonic/select'
import { groupByIndexLetter, IGNORED_ARTICLES } from '~/server/utils/subsonic/indexing'
import { toArtist, toAlbum, toSong } from '~/server/utils/subsonic/mappers'
import type { XmlObject } from '~/server/utils/subsonic/xml'
import type { HandlerContext } from '~/server/utils/subsonic/types'

const NO_STARRED = new Map<string, Date>()

export const getArtists = async (_event: H3Event, _ctx: HandlerContext): Promise<XmlObject> => {
  const artists = await prisma.artist.findMany({
    where: subsonicArtistWhere,
    select: ARTIST_SELECT,
    orderBy: { name: 'asc' },
  })
  const grouped = groupByIndexLetter(artists)
  return {
    artists: {
      ignoredArticles: IGNORED_ARTICLES,
      index: grouped.map(([letter, items]) => ({
        name: letter,
        artist: items.map(a => toArtist(a, { starred: NO_STARRED })),
      })),
    },
  }
}

export const getArtist = async (_event: H3Event, ctx: HandlerContext): Promise<XmlObject> => {
  const id = ctx.params.strRequired('id')
  const artist = await prisma.artist.findFirst({ where: { id, ...subsonicArtistWhere }, select: ARTIST_SELECT })
  if (!artist) {throw new SubsonicApiError(SubsonicErrorCode.NOT_FOUND, 'Artist not found')}

  const albums = await prisma.localRelease.findMany({
    where: { ...subsonicAlbumWhere, artists: { some: { artistId: id } } },
    select: ALBUM_SELECT,
    orderBy: [{ year: 'asc' }, { title: 'asc' }],
  })

  const albumIds = albums.map(a => a.id)
  const [plays, starred] = await Promise.all([
    releasePlayTotals(ctx.user.id, albumIds),
    favoriteReleaseDates(ctx.user.id, albumIds),
  ])

  return {
    artist: {
      ...toArtist(artist, { starred: NO_STARRED }),
      album: albums.map(a => toAlbum(a, { plays, starred })),
    },
  }
}

export const getAlbum = async (_event: H3Event, ctx: HandlerContext): Promise<XmlObject> => {
  const id = ctx.params.strRequired('id')
  const release = await prisma.localRelease.findFirst({
    where: { id, ...subsonicAlbumWhere },
    select: { ...ALBUM_SELECT, tracks: { orderBy: [{ discNumber: 'asc' }, { trackNumber: 'asc' }], select: SONG_SELECT } },
  })
  if (!release) {throw new SubsonicApiError(SubsonicErrorCode.NOT_FOUND, 'Album not found')}

  const trackIds = release.tracks.map(t => t.id)
  const [albumPlays, albumStarred, trackPlays, trackStarred] = await Promise.all([
    releasePlayTotals(ctx.user.id, [release.id]),
    favoriteReleaseDates(ctx.user.id, [release.id]),
    trackPlaysByIds(ctx.user.id, trackIds),
    favoriteTrackDates(ctx.user.id, trackIds),
  ])

  return {
    album: {
      ...toAlbum(release, { plays: albumPlays, starred: albumStarred }),
      song: release.tracks.map(t => toSong(t, { plays: trackPlays, starred: trackStarred })),
    },
  }
}

export const getSong = async (_event: H3Event, ctx: HandlerContext): Promise<XmlObject> => {
  const id = ctx.params.strRequired('id')
  const track = await prisma.localReleaseTrack.findUnique({ where: { id }, select: SONG_SELECT })
  if (!track) {throw new SubsonicApiError(SubsonicErrorCode.NOT_FOUND, 'Song not found')}

  const [plays, starred] = await Promise.all([
    trackPlaysByIds(ctx.user.id, [id]),
    favoriteTrackDates(ctx.user.id, [id]),
  ])
  return { song: toSong(track, { plays, starred }) }
}

export const getGenres = async (_event: H3Event, _ctx: HandlerContext): Promise<XmlObject> => {
  const rows = await prisma.$queryRaw<{ genre: string, songCount: bigint, albumCount: bigint }[]>`
    SELECT genre, count(*)::bigint AS "songCount",
           count(DISTINCT "localReleaseId")::bigint AS "albumCount"
    FROM "LocalReleaseTrack"
    WHERE genre IS NOT NULL AND genre <> ''
    GROUP BY genre
    ORDER BY genre ASC
  `
  return {
    genres: {
      genre: rows.map(r => ({ value: r.genre, songCount: Number(r.songCount), albumCount: Number(r.albumCount) })),
    },
  }
}
