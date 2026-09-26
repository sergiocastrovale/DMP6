import type { PlayerTrack } from '~/types/player'

// What every source of tracks (a release, an artist's list, a playlist, the search results) has in common. All optional:
// gap tracks and thin API rows are missing pieces.
export interface PlayerTrackSource {
  id: string
  title?: string | null
  artist?: string | null
  albumArtist?: string | null
  album?: string | null
  duration?: number | null
  localReleaseId?: string | null
}

// What the caller knows about the track's surroundings rather than the track itself.
export interface PlayerTrackContext {
  artistSlug?: string | null
  releaseImage?: string | null
  releaseImageUrl?: string | null
  // Used when the track carries no album of its own (a release page knows its own title).
  album?: string | null
}

// The one mapping into the player's queue shape, with the one set of fallbacks: 'Unknown' for a missing title or
// artist, an empty album, zero duration, and the cover the caller supplies (null when none is known).
export const toPlayerTrack = (t: PlayerTrackSource, ctx: PlayerTrackContext = {}): PlayerTrack => ({
  id: t.id,
  title: t.title || 'Unknown',
  artist: t.artist || t.albumArtist || 'Unknown',
  album: t.album || ctx.album || '',
  duration: t.duration || 0,
  artistSlug: ctx.artistSlug || null,
  releaseImage: ctx.releaseImage || null,
  releaseImageUrl: ctx.releaseImageUrl || null,
  localReleaseId: t.localReleaseId ?? null,
})

// A track as /api/playlists/[slug] shapes it (its release nested inside) -> the player's queue shape.
export const playlistTrackToPlayerTrack = (track: {
  id: string
  title?: string | null
  duration?: number | null
  release?: { id?: string | null, title?: string | null, image?: string | null, imageUrl?: string | null, artist?: { name?: string | null, slug?: string | null } | null } | null
}): PlayerTrack => toPlayerTrack({
  id: track.id,
  title: track.title,
  artist: track.release?.artist?.name,
  album: track.release?.title,
  duration: track.duration,
  localReleaseId: track.release?.id,
}, {
  artistSlug: track.release?.artist?.slug,
  releaseImage: track.release?.image,
  releaseImageUrl: track.release?.imageUrl,
})
