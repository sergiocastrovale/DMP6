import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' })

  await prisma.localReleaseTrack.update({
    where: { id },
    data: {
      playCount: { increment: 1 },
      lastPlayedAt: new Date(),
    },
  })

  // Also update release and artist play counts
  const track = await prisma.localReleaseTrack.findUnique({
    where: { id },
    select: {
      localRelease: {
        select: {
          id: true,
          artistId: true,
        },
      },
    },
  })

  if (track?.localRelease) {
    await Promise.all([
      prisma.localRelease.update({
        where: { id: track.localRelease.id },
        data: {
          totalPlayCount: { increment: 1 },
          lastPlayedAt: new Date(),
        },
      }),
      prisma.artist.update({
        where: { id: track.localRelease.artistId },
        data: {
          totalPlayCount: { increment: 1 },
        },
      }),
    ])
  }

  return { ok: true }
})
