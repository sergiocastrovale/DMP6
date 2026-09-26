import { prisma } from '~/server/utils/prisma'
import { getCachedSettings } from '~/server/utils/settingsCache'
import { callLastFm, describeLastfmProblem, isLastfmConfigured } from '~/server/utils/lastfm'
import { monitorLog } from '~/server/utils/monitorLog'

// Sends one finished listen to Last.fm with the global session (per-user sessions are a separate decision). Called
// where a play is counted on the server - a web listen crossing the scrobble threshold, a Subsonic client's scrobble -
// so every client is covered by one rule instead of each one deciding for itself. Returns whether it was sent.
export const scrobbleTrack = async (trackId: string, startedAtMs: number): Promise<boolean> => {
  const settings = getCachedSettings()
  if (!isLastfmConfigured(settings)) {
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
export const scrobbleInBackground = (trackId: string, startedAtMs: number): void => {
  scrobbleTrack(trackId, startedAtMs).catch((e: any) => {
    monitorLog('warn', `scrobble failed: ${e?.message || e}`)
  })
}
