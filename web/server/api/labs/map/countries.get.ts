import { cachedResponse } from '~/server/utils/cache'
import { COUNTRY_NAMES } from '~/server/utils/countries'
import { verifyImage } from '~/server/utils/images'

interface CountryRow {
  country: string
  artist_count: string
  images: string[] | null
  image_urls: string[] | null
}

export interface MapCountry {
  name: string
  count: number
  images: { image: string | null; imageUrl: string | null }[]
}

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  return cachedResponse<Record<string, MapCountry>>('map:countries', 86400, async () => {
    const rows = await prisma.$queryRaw<CountryRow[]>`
      WITH candidates AS (
        SELECT
          a.country,
          lr.image,
          lr."imageUrl",
          ROW_NUMBER() OVER (
            PARTITION BY a.country, COALESCE(lr.image, lr."imageUrl")
            ORDER BY lr."createdAt" DESC
          ) as rn
        FROM "Artist" a
        JOIN "LocalReleaseArtist" lra ON lra."artistId" = a.id
        JOIN "LocalRelease" lr ON lr.id = lra."localReleaseId"
        WHERE a.country IS NOT NULL
          AND a."relatedOnly" = false
          AND (lr.image IS NOT NULL OR lr."imageUrl" IS NOT NULL)
      ),
      unique_images AS (
        SELECT country, image, "imageUrl"
        FROM candidates
        WHERE rn = 1
      )
      SELECT
        country,
        COUNT(*)::text as artist_count,
        (array_agg(image) FILTER (WHERE image IS NOT NULL))[:50] as images,
        (array_agg("imageUrl") FILTER (WHERE "imageUrl" IS NOT NULL))[:50] as image_urls
      FROM unique_images
      GROUP BY country
      ORDER BY COUNT(*) DESC
    `

    const result: Record<string, MapCountry> = {}

    for (const row of rows) {
      const localImages = row.images ?? []
      const remoteImages = row.image_urls ?? []

      const verified = localImages.map((img, i) =>
        verifyImage(img, remoteImages[i] ?? null, 'releases'),
      )

      if (verified.length === 0) {
        continue
      }

      result[row.country] = {
        name: COUNTRY_NAMES[row.country] ?? row.country,
        count: parseInt(row.artist_count, 10),
        images: verified.slice(0, 50),
      }
    }

    return result
  })
})
