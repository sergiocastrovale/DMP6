import type { Prisma } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'

// Shared field selections for the /rest/* mappers (server/utils/subsonic/mappers.ts) - one
// definition per entity so getArtist/getAlbum/getSong/getAlbumList2/search3/getPlaylist/
// getStarred2 never drift on which columns/relations a row carries.
export const ARTIST_SELECT = {
  id: true,
  name: true,
  image: true,
  imageUrl: true,
  _count: { select: { localReleases: true } },
} satisfies Prisma.ArtistSelect

export const ALBUM_SELECT = {
  id: true,
  title: true,
  year: true,
  image: true,
  imageUrl: true,
  totalDuration: true,
  createdAt: true,
  artists: { take: 1, select: { artist: { select: { id: true, name: true } } } },
  _count: { select: { tracks: true } },
} satisfies Prisma.LocalReleaseSelect

export const SONG_SELECT = {
  id: true,
  title: true,
  trackNumber: true,
  discNumber: true,
  year: true,
  genre: true,
  duration: true,
  bitrate: true,
  sampleRate: true,
  filePath: true,
  fileSize: true,
  createdAt: true,
  localReleaseId: true,
  localRelease: {
    select: { id: true, title: true, artists: { take: 1, select: { artist: { select: { id: true, name: true } } } } },
  },
} satisfies Prisma.LocalReleaseTrackSelect

export type ArtistRow = Prisma.ArtistGetPayload<{ select: typeof ARTIST_SELECT }>
export type AlbumRow = Prisma.LocalReleaseGetPayload<{ select: typeof ALBUM_SELECT }>
export type SongRow = Prisma.LocalReleaseTrackGetPayload<{ select: typeof SONG_SELECT }>

// Re-orders a findMany result (unordered w.r.t. `id: { in: ids } }`) back into `ids`' own order -
// used when `ids` already carries a meaningful order (search rank, shuffle, play-count DESC).
const byIds = <T extends { id: string }>(rows: T[], ids: string[]): T[] => {
  const map = new Map(rows.map(r => [r.id, r]))
  return ids.map(id => map.get(id)).filter((r): r is T => !!r)
}

export const hydrateArtistsByIds = async (ids: string[]): Promise<ArtistRow[]> => {
  if (!ids.length) {return []}
  const rows = await prisma.artist.findMany({ where: { id: { in: ids } }, select: ARTIST_SELECT })
  return byIds(rows, ids)
}

export const hydrateAlbumsByIds = async (ids: string[]): Promise<AlbumRow[]> => {
  if (!ids.length) {return []}
  const rows = await prisma.localRelease.findMany({ where: { id: { in: ids } }, select: ALBUM_SELECT })
  return byIds(rows, ids)
}

export const hydrateSongsByIds = async (ids: string[]): Promise<SongRow[]> => {
  if (!ids.length) {return []}
  const rows = await prisma.localReleaseTrack.findMany({ where: { id: { in: ids } }, select: SONG_SELECT })
  return byIds(rows, ids)
}
