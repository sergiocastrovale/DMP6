import type { Artist, LocalReleaseTrack } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import { getCachedSettings } from '~/server/utils/settingsCache'
import { cachedResponse } from '~/server/utils/cache'
import { extractFacts, pickSongHit, type FactSubject, type GeniusSearchHit } from '~/server/utils/geniusFacts'

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
      const res = await fetch(`${GENIUS_API_URL}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(GENIUS_TIMEOUT_MS),
      })
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

const randomOwnedTrack = async (artistId: string): Promise<LocalReleaseTrack | null> => {
  const where = { localRelease: { artists: { some: { artistId } } }, title: { not: null } }
  const count = await prisma.localReleaseTrack.count({ where })
  if (!count) {return null}
  return prisma.localReleaseTrack.findFirst({ where, skip: Math.floor(Math.random() * count) })
}

export interface FetchedFacts {
  facts: string[]
  releaseId?: string
  trackId?: string
  sourceUrl: string | null
}

// Tries the requested subject first, then falls through the others (artist last, since a bio is the
// one most likely to exist) so one visit yields something whenever Genius has anything at all.
export const fetchArtistFacts = async (artist: Artist, subject: FactSubject): Promise<FetchedFacts | null> => {
  if (!isGeniusConfigured()) {return null}

  const order: FactSubject[] = [subject, ...(['track', 'release', 'artist'] as FactSubject[]).filter(s => s !== subject)]

  for (const attempt of order) {
    const track = await randomOwnedTrack(artist.id)
    if (!track?.title) {continue}

    const hit = await searchSong(track.title, artist.name)
    if (!hit) {continue}

    if (attempt === 'track') {
      const song = await geniusGet<{ song: GeniusSong }>(`/songs/${hit.id}?text_format=plain`)
      const facts = extractFacts(song?.song?.description?.plain)
      if (facts.length) {return { facts, trackId: track.id, sourceUrl: song?.song?.url ?? null }}
    }

    if (attempt === 'release') {
      const song = await geniusGet<{ song: GeniusSong }>(`/songs/${hit.id}?text_format=plain`)
      if (!song?.song?.album) {continue}
      const album = await geniusGet<{ album: { url?: string, description_annotation?: { annotations?: Array<{ body?: { plain?: string } }> } } }>(
        `/albums/${song.song.album.id}?text_format=plain`,
      )
      const facts = extractFacts(album?.album?.description_annotation?.annotations?.[0]?.body?.plain)
      const release = await prisma.localReleaseTrack.findUnique({
        where: { id: track.id },
        select: { localReleaseId: true },
      })
      if (facts.length && release?.localReleaseId) {
        return { facts, releaseId: release.localReleaseId, sourceUrl: album?.album?.url ?? null }
      }
    }

    if (attempt === 'artist') {
      const geniusArtist = await geniusGet<{ artist: { url?: string, description?: { plain?: string } } }>(
        `/artists/${hit.primary_artist.id}?text_format=plain`,
      )
      const facts = extractFacts(geniusArtist?.artist?.description?.plain)
      if (facts.length) {return { facts, sourceUrl: geniusArtist?.artist?.url ?? null }}
    }
  }

  return null
}
