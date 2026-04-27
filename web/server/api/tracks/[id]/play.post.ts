import { prisma } from '~/server/utils/prisma'
import { invalidateCache } from '~/server/utils/cache'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Missing id' })

  const track = await prisma.localReleaseTrack.findUnique({
    where: { id },
    select: {
      localRelease: {
        select: {
          id: true,
          artists: {
            select: { artist: { select: { id: true, slug: true } } },
          },
        },
      },
    },
  })

  if (!track) {
    throw createError({ statusCode: 404, statusMessage: 'Track not found' })
  }

  const now = new Date()
  const ops = [
    prisma.localReleaseTrack.update({
      where: { id },
      data: { playCount: { increment: 1 }, lastPlayedAt: now },
    }),
  ]

  if (track.localRelease) {
    ops.push(
      prisma.localRelease.update({
        where: { id: track.localRelease.id },
        data: { totalPlayCount: { increment: 1 }, lastPlayedAt: now },
      }) as any,
    )
    for (const lra of track.localRelease.artists) {
      ops.push(
        prisma.artist.update({
          where: { id: lra.artist.id },
          data: { totalPlayCount: { increment: 1 } },
        }) as any,
      )
    }
  }

  await prisma.$transaction(ops)

  if (track.localRelease) {

    // Invalidate caches affected by play counts / lastPlayedAt
    const cacheInvalidations: Promise<void>[] = [
      invalidateCache('releases:last-played:*'),
      invalidateCache('stats'),
    ]
    for (const lra of track.localRelease.artists) {
      if (lra.artist.slug) cacheInvalidations.push(invalidateCache(`artist:${lra.artist.slug}`))
    }
    await Promise.all(cacheInvalidations)
  }

  return { ok: true }
})
