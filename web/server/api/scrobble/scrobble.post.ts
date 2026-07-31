import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { getCachedSettings } from '~/server/utils/settingsCache'
import { callLastFm, isLastfmConfigured } from '~/server/utils/lastfm'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'play.view')

  const { trackId, timestamp } = (await readBody(event)) ?? {}
  if (!trackId || !timestamp) {
    throw createError({ statusCode: 400, message: 'Missing trackId or timestamp' })
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
    'artist[0]': track.artist,
    'track[0]': track.title,
    'timestamp[0]': String(Math.floor(Number(timestamp) / 1000)),
  }
  if (track.album) {params['album[0]'] = track.album}
  if (track.duration) {params['duration[0]'] = String(track.duration)}
  if (track.trackNumber) {params['trackNumber[0]'] = String(track.trackNumber)}

  await callLastFm('track.scrobble', params, settings)

  return { ok: true }
})
