import type { H3Event } from 'h3'
import { Prisma } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import { releasePlayTotals, trackPlaysByIds } from '~/server/utils/userPlays'
import { favoriteReleaseDates, favoriteTrackDates } from '~/server/utils/favorites'
import { subsonicAlbumWhere } from '~/server/utils/subsonic/scope'
import { ALBUM_SELECT, SONG_SELECT, hydrateAlbumsByIds, hydrateSongsByIds, type AlbumRow } from '~/server/utils/subsonic/select'
import { clamp } from '~/server/utils/subsonic/util'
import { sampleIds } from '~/server/utils/randomSample'
import { toAlbum, toSong } from '~/server/utils/subsonic/mappers'
import type { XmlObject } from '~/server/utils/subsonic/xml'
import type { HandlerContext } from '~/server/utils/subsonic/types'

const MAX_LIST_SIZE = 500

const hydrateAlbumsInOrder = async (ids: string[]): Promise<AlbumRow[]> => hydrateAlbumsByIds(ids)

export const getAlbumList2 = async (_event: H3Event, ctx: HandlerContext): Promise<XmlObject> => {
  const type = ctx.params.strRequired('type')
  const size = clamp(ctx.params.int('size') ?? 10, 1, MAX_LIST_SIZE)
  const offset = ctx.params.int('offset') ?? 0

  let albums: AlbumRow[]

  switch (type) {
    case 'newest':
      albums = await prisma.localRelease.findMany({ where: subsonicAlbumWhere, select: ALBUM_SELECT, orderBy: { createdAt: 'desc' }, skip: offset, take: size })
      break

    case 'alphabeticalByName':
      albums = await prisma.localRelease.findMany({ where: subsonicAlbumWhere, select: ALBUM_SELECT, orderBy: { title: 'asc' }, skip: offset, take: size })
      break

    case 'alphabeticalByArtist': {
      // No direct column to order a many-to-many relation by - resolve the id order via a join,
      // then hydrate the full rows through the shared select (same pattern as frequent/recent below).
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT lr.id
        FROM "LocalRelease" lr
        JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
        JOIN "Artist" a ON a.id = lra."artistId"
        WHERE EXISTS (SELECT 1 FROM "LocalReleaseTrack" t WHERE t."localReleaseId" = lr.id)
        GROUP BY lr.id
        ORDER BY MIN(a.name) ASC
        OFFSET ${offset} LIMIT ${size}
      `
      albums = await hydrateAlbumsInOrder(rows.map(r => r.id))
      break
    }

    case 'byYear': {
      const fromYear = ctx.params.int('fromYear') ?? 0
      const toYear = ctx.params.int('toYear') ?? 9999
      const [lo, hi] = fromYear <= toYear ? [fromYear, toYear] : [toYear, fromYear]
      albums = await prisma.localRelease.findMany({
        where: { ...subsonicAlbumWhere, year: { gte: lo, lte: hi } },
        select: ALBUM_SELECT,
        orderBy: { year: fromYear <= toYear ? 'asc' : 'desc' },
        skip: offset,
        take: size,
      })
      break
    }

    case 'byGenre': {
      const genre = ctx.params.strRequired('genre')
      albums = await prisma.localRelease.findMany({
        where: { ...subsonicAlbumWhere, tracks: { some: { genre } } },
        select: ALBUM_SELECT,
        orderBy: { title: 'asc' },
        skip: offset,
        take: size,
      })
      break
    }

    case 'starred': {
      // Box favorites (releaseId null) have no Subsonic album - only LocalReleases are albums there.
      const favs = await prisma.favoriteRelease.findMany({
        where: { userId: ctx.user.id, releaseId: { not: null } },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: size,
        select: { release: { select: ALBUM_SELECT } },
      })
      albums = favs.flatMap(f => f.release ? [f.release] : [])
      break
    }

    case 'frequent': {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT lrt."localReleaseId" AS id
        FROM "LocalReleaseTrackPlay" p
        JOIN "LocalReleaseTrack" lrt ON lrt.id = p."trackId"
        WHERE p."userId" = ${ctx.user.id} AND lrt."localReleaseId" IS NOT NULL
        GROUP BY lrt."localReleaseId"
        ORDER BY SUM(p."playCount") DESC
        OFFSET ${offset} LIMIT ${size}
      `
      albums = await hydrateAlbumsInOrder(rows.map(r => r.id))
      break
    }

    case 'recent': {
      const rows = await prisma.$queryRaw<{ id: string }[]>`
        SELECT lrt."localReleaseId" AS id
        FROM "LocalReleaseTrackPlay" p
        JOIN "LocalReleaseTrack" lrt ON lrt.id = p."trackId"
        WHERE p."userId" = ${ctx.user.id} AND lrt."localReleaseId" IS NOT NULL
        GROUP BY lrt."localReleaseId"
        ORDER BY MAX(p."lastPlayedAt") DESC
        OFFSET ${offset} LIMIT ${size}
      `
      albums = await hydrateAlbumsInOrder(rows.map(r => r.id))
      break
    }

    case 'random':
    default: {
      // Sampled across the whole library (randomSample.ts). `offset` is ignored: every call is a fresh draw,
      // which is what clients expect of `random` - paging through a random list is meaningless.
      const ids = await sampleIds(
        prisma, 'LocalRelease', size,
        Prisma.sql`EXISTS (SELECT 1 FROM "LocalReleaseTrack" t WHERE t."localReleaseId" = "LocalRelease".id)`,
      )
      albums = await hydrateAlbumsInOrder(ids)
      break
    }
  }

  const albumIds = albums.map(a => a.id)
  const [plays, starred] = await Promise.all([
    releasePlayTotals(ctx.user.id, albumIds),
    favoriteReleaseDates(ctx.user.id, albumIds),
  ])

  return { albumList2: { album: albums.map(a => toAlbum(a, { plays, starred })) } }
}

export const getRandomSongs = async (_event: H3Event, ctx: HandlerContext): Promise<XmlObject> => {
  const size = clamp(ctx.params.int('size') ?? 10, 1, MAX_LIST_SIZE)
  const genre = ctx.params.str('genre')
  const fromYear = ctx.params.int('fromYear')
  const toYear = ctx.params.int('toYear')

  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`]
  if (genre) {conditions.push(Prisma.sql`"LocalReleaseTrack".genre = ${genre}`)}
  if (fromYear !== undefined) {conditions.push(Prisma.sql`"LocalReleaseTrack".year >= ${fromYear}`)}
  if (toYear !== undefined) {conditions.push(Prisma.sql`"LocalReleaseTrack".year <= ${toYear}`)}

  const ids = await sampleIds(prisma, 'LocalReleaseTrack', size, Prisma.join(conditions, ' AND '))
  const songs = await hydrateSongsByIds(ids)

  const [plays, starred] = await Promise.all([
    trackPlaysByIds(ctx.user.id, ids),
    favoriteTrackDates(ctx.user.id, ids),
  ])

  return { randomSongs: { song: songs.map(s => toSong(s, { plays, starred })) } }
}

// No artist array - DMP has no per-user FavoriteArtist (see mappers.ts's toArtist comment).
export const getStarred2 = async (_event: H3Event, ctx: HandlerContext): Promise<XmlObject> => {
  const [rawFavReleases, favTracks] = await Promise.all([
    prisma.favoriteRelease.findMany({
      where: { userId: ctx.user.id, releaseId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, release: { select: ALBUM_SELECT } },
    }),
    prisma.favoriteTrack.findMany({
      where: { userId: ctx.user.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, track: { select: SONG_SELECT } },
    }),
  ])

  // Box favorites are filtered out in the query (releaseId null); this narrows the type to match.
  const favReleases = rawFavReleases.flatMap(f => f.release ? [{ createdAt: f.createdAt, release: f.release }] : [])
  const albumIds = favReleases.map(f => f.release.id)
  const trackIds = favTracks.map(f => f.track.id)
  const [plays, trackPlays] = await Promise.all([
    releasePlayTotals(ctx.user.id, albumIds),
    trackPlaysByIds(ctx.user.id, trackIds),
  ])
  const starredAlbums = new Map(favReleases.map(f => [f.release.id, f.createdAt]))
  const starredTracks = new Map(favTracks.map(f => [f.track.id, f.createdAt]))

  return {
    starred2: {
      album: favReleases.map(f => toAlbum(f.release, { plays, starred: starredAlbums })),
      song: favTracks.map(f => toSong(f.track, { plays: trackPlays, starred: starredTracks })),
    },
  }
}
