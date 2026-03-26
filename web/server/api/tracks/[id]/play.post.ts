import { prisma } from '~/server/utils/prisma'
import { invalidateCache } from '~/server/utils/cache'

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
          artist: { select: { slug: true } },
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
        data: { totalPlayCount: { increment: 1 } },
      }),
    ])

    // Invalidate caches affected by play counts / lastPlayedAt
    const slug = track.localRelease.artist?.slug
    await Promise.all([
      invalidateCache('releases:last-played:*'),
      invalidateCache('stats'),
      slug ? invalidateCache(`artist:${slug}`) : Promise.resolve(),
    ])
  }

  return { ok: true }
})
