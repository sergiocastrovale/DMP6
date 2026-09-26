import { fetchWithTimeout } from '~/server/utils/fetchWithTimeout'
import type { Artist } from '@prisma/client'
import { getCachedSettings } from '~/server/utils/settingsCache'
import { cachedResponse } from '~/server/utils/cache'
import { extractFacts, pickSongHit, type GeniusSearchHit } from '~/server/utils/geniusFacts'

const GENIUS_API_URL = 'https://api.genius.com'
const GENIUS_TIMEOUT_MS = 8000
const GENIUS_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60 // avoid re-hitting Genius for the same lookup within a week

export const isGeniusConfigured = (): boolean => !!getCachedSettings().geniusAccessToken

interface GeniusSongResult {
  id: number
  title: string
  primary_artist: { id: number, name: string }
}

interface GeniusSong {
  id: number
  url: string
  description?: { plain?: string }
  album?: { id: number, name: string } | null
}

const geniusGet = async <T>(path: string): Promise<T | null> => {
  const token = getCachedSettings().geniusAccessToken
  if (!token) {return null}

  return cachedResponse(`genius:${path}`, GENIUS_CACHE_TTL_SECONDS, async () => {
    try {
      const res = await fetchWithTimeout(`${GENIUS_API_URL}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
      }, { timeoutMs: GENIUS_TIMEOUT_MS })
      if (!res.ok) {
        console.error(`[genius] ${path} -> HTTP ${res.status}`)
        return null
      }
      const body = await res.json()
      return body.response as T
    }
    catch (e: any) {
      console.error(`[genius] ${path} failed: ${e?.message || e}`)
      return null
    }
  })
}

// Genius' /search only returns songs, so finding this artist's own Genius artist id means searching
// for one of their tracks and matching the hit's primary_artist - there's no artist-name search.
const searchSong = async (title: string, artistName: string): Promise<GeniusSongResult | null> => {
  const search = await geniusGet<{ hits: GeniusSearchHit[] }>(
    `/search?q=${encodeURIComponent(`${title} ${artistName}`)}`,
  )
  if (!search?.hits?.length) {return null}
  return pickSongHit(search.hits, title, artistName)
}

export interface FetchedFacts {
  facts: string[]
  releaseId?: string
  trackId?: string
  sourceUrl: string | null
}

// Only what's actually read below - the caller passes a `select`-projected track, not a full
// Prisma LocalReleaseTrack row.
export interface TrackForFacts {
  id: string
  title: string | null
  localReleaseId: string | null
}

// Explore's "Did you know" widget already knows exactly what's playing, so unlike the old
// artist-page picker (random subject, random owned track) this is a deterministic cascade pinned to
// that one track: try a fact about the track itself, then its release, then the artist - stopping at
// the first tier with usable text, same specificity order the caller (server/api/tracks/[id]/fact.get.ts)
// checks the DB in.
export const fetchFactsForTrack = async (track: TrackForFacts, artist: Artist): Promise<FetchedFacts | null> => {
  if (!isGeniusConfigured() || !track.title) {return null}

  const hit = await searchSong(track.title, artist.name)
  if (!hit) {return null}

  const song = await geniusGet<{ song: GeniusSong }>(`/songs/${hit.id}?text_format=plain`)

  const trackFacts = extractFacts(song?.song?.description?.plain)
  if (trackFacts.length) {return { facts: trackFacts, trackId: track.id, sourceUrl: song?.song?.url ?? null }}

  if (song?.song?.album && track.localReleaseId) {
    const album = await geniusGet<{ album: { url?: string, description_annotation?: { annotations?: Array<{ body?: { plain?: string } }> } } }>(
      `/albums/${song.song.album.id}?text_format=plain`,
    )
    const releaseFacts = extractFacts(album?.album?.description_annotation?.annotations?.[0]?.body?.plain)
    if (releaseFacts.length) {
      return { facts: releaseFacts, releaseId: track.localReleaseId, sourceUrl: album?.album?.url ?? null }
    }
  }

  const geniusArtist = await geniusGet<{ artist: { url?: string, description?: { plain?: string } } }>(
    `/artists/${hit.primary_artist.id}?text_format=plain`,
  )
  const artistFacts = extractFacts(geniusArtist?.artist?.description?.plain)
  if (artistFacts.length) {return { facts: artistFacts, sourceUrl: geniusArtist?.artist?.url ?? null }}

  return null
}
