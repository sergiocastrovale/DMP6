import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { callLastFm, describeLastfmProblem } from '~/server/utils/lastfm'
import { lastfmCredentialsFor } from '~/server/utils/scrobble'
import { monitorLog } from '~/server/utils/monitorLog'
import { readBodyOf } from '~/server/utils/requestValidation'
import { nowPlayingBodySchema } from '~/server/schemas/scrobble'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'play.view')

  const { trackId } = await readBodyOf(event, nowPlayingBodySchema)

  const settings = await lastfmCredentialsFor(currentUserId(event))
  if (!settings) {
    return { ok: true, skipped: true }
  }

  const track = await prisma.localReleaseTrack.findUnique({
    where: { id: trackId },
    select: { title: true, artist: true, album: true, duration: true, trackNumber: true },
  })
  if (!track || !track.title || !track.artist) {
    return { ok: true, skipped: true }
  }

  const params: Record<string, string> = {
    artist: track.artist,
    track: track.title,
  }
  if (track.album) {params.album = track.album}
  if (track.duration) {params.duration = String(track.duration)}
  if (track.trackNumber) {params.trackNumber = String(track.trackNumber)}

  const result = await callLastFm('track.updateNowPlaying', params, settings)
  const problem = describeLastfmProblem(result)
  if (problem) {
    monitorLog('warn', `now-playing "${track.artist} - ${track.title}": ${problem}`)
  }

  return { ok: true }
})
