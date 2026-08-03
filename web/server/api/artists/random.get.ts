import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async () => {
  const rows = await prisma.$queryRaw<{ name: string, slug: string }[]>`
    SELECT name, slug
    FROM "Artist" TABLESAMPLE BERNOULLI(1)
    WHERE "primaryArtistId" IS NULL
      AND EXISTS (SELECT 1 FROM "LocalReleaseArtist" l WHERE l."artistId" = "Artist".id)
    LIMIT 1
  `

  if (rows.length === 0) {
    const fallback = await prisma.artist.findFirst({
      where: { primaryArtistId: null, localReleases: { some: {} } },
      select: { name: true, slug: true },
    })
    return fallback
  }

  return rows[0]
})
