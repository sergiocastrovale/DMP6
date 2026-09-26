import { prisma } from '~/server/utils/prisma'
import { errorMessage } from '~/helpers/functions'
import { getCachedSettings } from '~/server/utils/settingsCache'
import { callLastFm, describeLastfmProblem, isLastfmConfigured } from '~/server/utils/lastfm'
import { monitorLog } from '~/server/utils/monitorLog'
import { getUserLastfmSession } from '~/server/utils/lastfmSessions'
import type { LastfmSettings } from '~/types/api'

// The application's key and secret plus one user's session key: what a Last.fm call signs with.
export const lastfmCredentialsFor = async (userId: number): Promise<LastfmSettings | null> => {
  const session = await getUserLastfmSession(userId)
  if (!session) {
    return null
  }
  const { lastfmApiKey, lastfmSecret } = getCachedSettings()
  const credentials = { lastfmApiKey, lastfmSecret, lastfmSessionKey: session.sessionKey }
  return isLastfmConfigured(credentials) ? credentials : null
}

// Sends one finished listen to the listener's own Last.fm account, when they have connected one. Called where a play is
// counted on the server - a web listen crossing the scrobble threshold, a Subsonic client's scrobble - so every client
// is covered by one rule instead of each one deciding for itself. Returns whether it was sent.
export const scrobbleTrack = async (userId: number, trackId: string, startedAtMs: number): Promise<boolean> => {
  const settings = await lastfmCredentialsFor(userId)
  if (!settings) {
    return false
  }

  const track = await prisma.localReleaseTrack.findUnique({
    where: { id: trackId },
    select: { title: true, artist: true, album: true, duration: true, trackNumber: true },
  })
  if (!track?.title || !track.artist) {
    return false
  }

  const params: Record<string, string> = {
    'artist[0]': track.artist,
    'track[0]': track.title,
    'timestamp[0]': String(Math.floor(startedAtMs / 1000)),
  }
  if (track.album) {params['album[0]'] = track.album}
  if (track.duration) {params['duration[0]'] = String(track.duration)}
  if (track.trackNumber) {params['trackNumber[0]'] = String(track.trackNumber)}

  const result = await callLastFm('track.scrobble', params, settings)
  const problem = describeLastfmProblem(result)
  if (problem) {
    monitorLog('warn', `scrobble "${track.artist} - ${track.title}": ${problem}`)
    return false
  }
  return true
}

// Fire-and-forget: a slow or failing Last.fm never delays or fails the request that counted the play.
export const scrobbleInBackground = (userId: number, trackId: string, startedAtMs: number): void => {
  scrobbleTrack(userId, trackId, startedAtMs).catch((e: any) => {
    monitorLog('warn', `scrobble failed: ${errorMessage(e)}`)
  })
}
