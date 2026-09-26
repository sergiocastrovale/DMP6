import type { H3Event } from 'h3'
import { prisma } from '~/server/utils/prisma'
import { rankedArtistIds, rankedReleaseIds, rankedTrackIds } from '~/server/utils/searchRank'
import { releasePlayTotals, trackPlaysByIds } from '~/server/utils/userPlays'
import { favoriteReleaseDates, favoriteTrackDates } from '~/server/utils/favorites'
import { subsonicArtistWhere, subsonicAlbumWhere } from '~/server/utils/subsonic/scope'
import {
  ARTIST_SELECT, ALBUM_SELECT, SONG_SELECT,
  hydrateArtistsByIds, hydrateAlbumsByIds, hydrateSongsByIds,
  type ArtistRow, type AlbumRow, type SongRow,
} from '~/server/utils/subsonic/select'
import { clamp } from '~/server/utils/subsonic/util'
import { subsonicSeeker } from '~/server/utils/subsonic/seek'
import { toArtist, toAlbum, toSong } from '~/server/utils/subsonic/mappers'
import type { XmlObject } from '~/server/utils/subsonic/xml'
import type { HandlerContext } from '~/server/utils/subsonic/types'

const NO_STARRED = new Map<string, Date>()

// Empty query is a deliberate full listing, ordered by id - Symfonium's initial library sync pages
// through search3 with an empty query rather than browsing, so this can't just return nothing.
export const search3 = async (_event: H3Event, ctx: HandlerContext): Promise<XmlObject> => {
  const p = ctx.params
  const query = (p.str('query') ?? '').trim().replace(/^"|"$/g, '')
  const artistCount = clamp(p.int('artistCount') ?? 20, 0, 500)
  const artistOffset = p.int('artistOffset') ?? 0
  const albumCount = clamp(p.int('albumCount') ?? 20, 0, 500)
  const albumOffset = p.int('albumOffset') ?? 0
  const songCount = clamp(p.int('songCount') ?? 20, 0, 500)
  const songOffset = p.int('songOffset') ?? 0

  let artists: ArtistRow[]
  let albums: AlbumRow[]
  let songs: SongRow[]

  if (query) {
    const [artistIds, releaseIds, trackIds] = await Promise.all([
      rankedArtistIds(query, artistOffset, artistCount),
      rankedReleaseIds(query, albumOffset, albumCount),
      rankedTrackIds(query, songOffset, songCount),
    ])
    ;[artists, albums, songs] = await Promise.all([
      hydrateArtistsByIds(artistIds.ids),
      hydrateAlbumsByIds(releaseIds.ids),
      hydrateSongsByIds(trackIds.ids),
    ])
  }
  else {
    // A client's first sync walks every row at increasing offsets; subsonicSeeker turns that from quadratic
    // OFFSET scans into short seeks from remembered checkpoints (see seek.ts).
    const after = (afterId: string | null) => (afterId ? { id: { gt: afterId } } : {})
    ;[artists, albums, songs] = await Promise.all([
      subsonicSeeker.page('search3:artists', artistOffset, artistCount, (afterId, skip, take) =>
        prisma.artist.findMany({ where: { ...subsonicArtistWhere, ...after(afterId) }, orderBy: { id: 'asc' }, skip, take, select: ARTIST_SELECT })),
      subsonicSeeker.page('search3:albums', albumOffset, albumCount, (afterId, skip, take) =>
        prisma.localRelease.findMany({ where: { ...subsonicAlbumWhere, ...after(afterId) }, orderBy: { id: 'asc' }, skip, take, select: ALBUM_SELECT })),
      subsonicSeeker.page('search3:songs', songOffset, songCount, (afterId, skip, take) =>
        prisma.localReleaseTrack.findMany({ where: after(afterId), orderBy: { id: 'asc' }, skip, take, select: SONG_SELECT })),
    ])
  }

  const [releasePlays, trackPlays, starredAlbums, starredTracks] = await Promise.all([
    releasePlayTotals(ctx.user.id, albums.map(a => a.id)),
    trackPlaysByIds(ctx.user.id, songs.map(s => s.id)),
    favoriteReleaseDates(ctx.user.id, albums.map(a => a.id)),
    favoriteTrackDates(ctx.user.id, songs.map(s => s.id)),
  ])

  return {
    searchResult3: {
      artist: artists.map(a => toArtist(a, { starred: NO_STARRED })),
      album: albums.map(a => toAlbum(a, { plays: releasePlays, starred: starredAlbums })),
      song: songs.map(s => toSong(s, { plays: trackPlays, starred: starredTracks })),
    },
  }
}
