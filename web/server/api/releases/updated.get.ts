import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { verifyImage } from '~/server/utils/images'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, max-age=60, stale-while-revalidate=30')

  const query = getQuery(event)
  const limit = Math.min(Number(query.limit) || 50, 100)

  return cachedResponse(`releases:updated:${limit}`, 120, async () => {
    const releases = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM "LocalRelease"
      WHERE "updatedAt" > "createdAt"
      ORDER BY "updatedAt" DESC
      LIMIT ${limit}
    `

    const rows = await prisma.localRelease.findMany({
      where: { id: { in: releases.map(r => r.id) } },
      include: {
        artists: {
          select: { artist: { select: { id: true, name: true, slug: true } } },
        },
        release: {
          select: {
            id: true,
            title: true,
            type: { select: { name: true } },
          },
        },
        tracks: {
          where: { genre: { not: null } },
          select: { genre: true },
          take: 1,
        },
      },
    })

    const order = new Map(releases.map((r, i) => [r.id, i]))
    rows.sort((a, b) => order.get(a.id)! - order.get(b.id)!)

    return rows.map(release => ({
      id: release.id,
      title: release.title || release.release?.title || 'Unknown Release',
      releaseType: release.release?.type?.name || null,
      year: release.year,
      ...verifyImage(release.image, release.imageUrl, 'releases'),
      updatedAt: release.updatedAt,
      genre: release.tracks[0]?.genre || null,
      artist: release.artists[0]?.artist ?? null,
      musicBrainzId: release.release?.id || null,
    }))
  }, { shared: true })
})
