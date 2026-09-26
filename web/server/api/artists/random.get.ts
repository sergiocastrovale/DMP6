import { Prisma } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import { sampleIds } from '~/server/utils/randomSample'

// A random browsable artist (a primary that owns at least one release), for the "surprise me" link.
export default defineEventHandler(async () => {
  const [id] = await sampleIds(
    prisma, 'Artist', 1,
    Prisma.sql`"Artist"."primaryArtistId" IS NULL AND EXISTS (SELECT 1 FROM "LocalReleaseArtist" l WHERE l."artistId" = "Artist".id)`,
  )
  if (!id) {return null}
  return prisma.artist.findUnique({ where: { id }, select: { name: true, slug: true } })
})
