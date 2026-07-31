import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { getCachedSettings } from '~/server/utils/settingsCache'
import { callLastFm, describeLastfmProblem, isLastfmConfigured } from '~/server/utils/lastfm'
import { monitorLog } from '~/server/utils/monitorLog'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'play.view')

  const { trackId } = (await readBody(event)) ?? {}
  if (!trackId) {
    throw createError({ statusCode: 400, message: 'Missing trackId' })
  }

  const settings = await getCachedSettings()
  if (!settings || !isLastfmConfigured(settings)) {
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
