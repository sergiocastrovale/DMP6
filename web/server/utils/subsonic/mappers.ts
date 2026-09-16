import { mimeForFile } from '~/server/utils/audioRange'
import type { TrackPlayStats, ReleasePlayStats } from '~/server/utils/userPlays'
import type { XmlObject } from './xml'
import type { ArtistRow, AlbumRow, SongRow } from './select'
import { artistCoverArt, albumCoverArt } from './ids'

const extOf = (filePath: string): string => filePath.split('.').pop()?.toLowerCase() || 'mp3'

export interface ArtistMapContext {
  starred: Map<string, Date>
}

// DMP has no per-user FavoriteArtist (only FavoriteRelease/FavoriteTrack - see CLAUDE.md Data
// Model), so an artist's `starred` is always absent; `ctx.starred` exists for call-site symmetry
// with toAlbum/toSong and is expected to always be an empty map.
export const toArtist = (row: ArtistRow, ctx: ArtistMapContext): XmlObject => {
  const starredAt = ctx.starred.get(row.id)
  return {
    id: row.id,
    name: row.name,
    coverArt: artistCoverArt(row.id),
    albumCount: row._count.localReleases,
    starred: starredAt ? starredAt.toISOString() : undefined,
  }
}

export interface AlbumMapContext {
  plays: Map<string, ReleasePlayStats>
  starred: Map<string, Date>
}

export const toAlbum = (row: AlbumRow, ctx: AlbumMapContext): XmlObject => {
  const artist = row.artists[0]?.artist
  const stats = ctx.plays.get(row.id)
  const starredAt = ctx.starred.get(row.id)
  return {
    id: row.id,
    parent: artist?.id,
    isDir: true,
    name: row.title,
    title: row.title,
    album: row.title,
    artist: artist?.name,
    artistId: artist?.id,
    coverArt: albumCoverArt(row.id),
    songCount: row._count.tracks,
    duration: row.totalDuration ?? 0,
    playCount: stats?.totalPlayCount || undefined,
    played: stats?.lastPlayedAt ? stats.lastPlayedAt.toISOString() : undefined,
    year: row.year ?? undefined,
    starred: starredAt ? starredAt.toISOString() : undefined,
    created: row.createdAt.toISOString(),
  }
}

export interface SongMapContext {
  plays: Map<string, TrackPlayStats>
  starred: Map<string, Date>
}

export const toSong = (row: SongRow, ctx: SongMapContext): XmlObject => {
  const album = row.localRelease
  const artist = album?.artists[0]?.artist
  const stats = ctx.plays.get(row.id)
  const starredAt = ctx.starred.get(row.id)
  return {
    id: row.id,
    parent: album?.id,
    isDir: false,
    title: row.title ?? 'Unknown',
    album: album?.title,
    albumId: album?.id ?? undefined,
    artist: artist?.name,
    artistId: artist?.id,
    track: row.trackNumber ?? undefined,
    discNumber: row.discNumber ?? undefined,
    year: row.year ?? undefined,
    genre: row.genre ?? undefined,
    coverArt: album ? albumCoverArt(album.id) : undefined,
    size: row.fileSize ? Number(row.fileSize) : undefined,
    contentType: mimeForFile(row.filePath),
    suffix: extOf(row.filePath),
    duration: row.duration ?? undefined,
    bitRate: row.bitrate ?? undefined,
    samplingRate: row.sampleRate ?? undefined,
    path: row.filePath,
    playCount: stats?.playCount || undefined,
    played: stats?.lastPlayedAt ? stats.lastPlayedAt.toISOString() : undefined,
    starred: starredAt ? starredAt.toISOString() : undefined,
    created: row.createdAt.toISOString(),
    type: 'music',
    isVideo: false,
  }
}
