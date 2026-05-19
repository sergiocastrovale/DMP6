import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing id' })
  }

  const track = await prisma.localReleaseTrack.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      artist: true,
      albumArtist: true,
      album: true,
      year: true,
      genre: true,
      duration: true,
      bitrate: true,
      sampleRate: true,
      filePath: true,
      trackNumber: true,
      discNumber: true,
      fileSize: true,
      playCount: true,
      lastPlayedAt: true,
      mbTrackId: true,
      mbReleaseId: true,
      mbReleaseGroupId: true,
      mbAlbumArtistId: true,
      metadata: true,
      createdAt: true,
    },
  })

  if (!track) {
    throw createError({ statusCode: 404, statusMessage: 'Track not found' })
  }

  const meta = track.metadata as Record<string, unknown> | null
  const bpm = meta?.IntegerBpm as string | null ?? null
  const isrc = meta?.Isrc as string | null ?? null
  const label = meta?.Label as string | null ?? meta?.LABEL as string | null ?? null
  const acousticId = meta?.AcoustidId as string | null ?? meta?.ACOUSTID_ID as string | null ?? null
  const mood = meta?.Mood as string | null ?? meta?.MOOD as string | null ?? null
  const key = meta?.InitialKey as string | null ?? meta?.KEY as string | null ?? null
  const replayGain = meta?.ReplayGainTrackGain as string | null ?? null
  const encoder = meta?.Encoder as string | null ?? meta?.ENCODER as string | null ?? null

  return {
    ...track,
    fileSize: track.fileSize ? Number(track.fileSize) : null,
    bpm,
    isrc,
    label,
    acousticId,
    mood,
    key,
    replayGain,
    encoder,
  }
})
