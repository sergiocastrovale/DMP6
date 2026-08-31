import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import { buildReleaseCard } from '~/server/utils/releaseAggregation'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'Missing id' })
  }

  const lr = await prisma.localRelease.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      year: true,
      folderPath: true,
      image: true,
      imageUrl: true,
      matchStatus: true,
      releaseId: true,
      totalPlayCount: true,
      tracks: { select: { id: true } },
      artists: {
        select: {
          artist: { select: { name: true, slug: true } },
        },
      },
      release: {
        select: {
          id: true,
          title: true,
          year: true,
          musicbrainzId: true,
          releaseGroupId: true,
          disambiguation: true,
          editionLabel: true,
          releaseDate: true,
          packaging: true,
          country: true,
          format: true,
          status: true,
          statusReason: true,
          type: { select: { name: true, slug: true } },
          tracks: { select: { id: true } },
        },
      },
    },
  })

  if (!lr) {
    throw createError({ statusCode: 404, statusMessage: 'Release not found' })
  }

  return buildReleaseCard(lr, lr.release, verifyImage)
})
