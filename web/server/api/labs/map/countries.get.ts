import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { COUNTRY_NAMES } from '~/server/utils/countries'
import { fetchCountryRows } from '~/server/utils/countryCovers'
import { verifyImage, primeImageExistence } from '~/server/utils/images'
import type { MapCountry } from '~/types/labs'

export default defineEventHandler(async (event) => {
  if (!event.context.user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  // v2: the payload's counts and image pairing changed shape-compatibly, so the old 24h entry must not be served.
  return cachedResponse<Record<string, MapCountry>>('map:countries:v2', 86400, async () => {
    const rows = await fetchCountryRows(prisma)

    await primeImageExistence('releases', rows.flatMap(row => (row.images ?? []).map(cover => cover.image)))
    const result: Record<string, MapCountry> = {}
    for (const row of rows) {
      const verified = (row.images ?? []).map(cover => verifyImage(cover.image, cover.imageUrl, 'releases'))
      if (verified.length === 0) {
        continue
      }
      result[row.country] = {
        name: COUNTRY_NAMES[row.country] ?? row.country,
        count: parseInt(row.artist_count, 10),
        images: verified,
      }
    }
    return result
  }, { shared: true })
})
