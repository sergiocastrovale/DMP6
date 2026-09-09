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
      mediumPosition: true,
      boxReleaseId: true,
      boxMediumPosition: true,
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
          mediumCount: true,
          media: {
            select: { position: true, title: true, equivalentReleaseId: true, equivalentReleaseGroupId: true },
            orderBy: { position: 'asc' },
          },
          type: { select: { name: true, slug: true } },
          tracks: { select: { id: true } },
        },
      },
    },
  })

  if (!lr) {
    throw createError({ statusCode: 404, statusMessage: 'Release not found' })
  }

  const boxMbr = lr.boxReleaseId
    ? await prisma.musicBrainzRelease.findUnique({
      where: { id: lr.boxReleaseId },
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
        mediumCount: true,
        media: {
          select: { position: true, title: true, equivalentReleaseId: true, equivalentReleaseGroupId: true },
          orderBy: { position: 'asc' },
        },
        type: { select: { name: true, slug: true } },
        tracks: { select: { id: true } },
      },
    })
    : null

  // docs/sync_decisions.md: box sets in the catalogue that reprint this release's whole release group -
  // a pure catalogue fact, independent of whether this artist owns any copy of them.
  const alsoPartOf = lr.release?.releaseGroupId
    ? (await prisma.musicBrainzReleaseMedium.findMany({
      where: { equivalentReleaseGroupId: lr.release.releaseGroupId },
      select: { release: { select: { title: true, year: true } } },
    })).map(m => m.release)
    : undefined

  return buildReleaseCard(lr, lr.release, verifyImage, { boxMbr, alsoPartOf })
})
