import type { Db } from '~/server/utils/statementTimeout'
import type { CountryRow } from '~/types/labs'

export const MAP_COVERS_PER_COUNTRY = 150

// Per country for the labs world map: how many browsable artists it has, and up to 150 distinct cover images
// (newest first) as (image, imageUrl) PAIRS. The previous query aggregated `image` and `imageUrl` into two
// separately-FILTERed arrays, so images[i] and image_urls[i] could belong to different releases and the page
// paired them anyway; it also reported the number of distinct covers as the "artist count".
//
// An "artist" here is one that owns at least one release and isn't a connected duplicate - the same rule as
// /browse and /api/labs/map/artists, so the number on the map matches the list it opens.
export const fetchCountryRows = (prisma: Db): Promise<CountryRow[]> =>
  prisma.$queryRaw<CountryRow[]>`
    WITH candidates AS (
      SELECT
        a.country,
        lr.image,
        lr."imageUrl",
        lr."createdAt",
        ROW_NUMBER() OVER (
          PARTITION BY a.country, COALESCE(lr.image, lr."imageUrl")
          ORDER BY lr."createdAt" DESC
        ) AS rn
      FROM "Artist" a
      JOIN "LocalReleaseArtist" lra ON lra."artistId" = a.id
      JOIN "LocalRelease" lr ON lr.id = lra."localReleaseId"
      WHERE a.country IS NOT NULL
        AND a."primaryArtistId" IS NULL
        AND (lr.image IS NOT NULL OR lr."imageUrl" IS NOT NULL)
    ),
    ranked AS (
      SELECT country, image, "imageUrl",
             ROW_NUMBER() OVER (PARTITION BY country ORDER BY "createdAt" DESC) AS pos
      FROM candidates
      WHERE rn = 1
    ),
    covers AS (
      SELECT country,
             jsonb_agg(jsonb_build_object('image', image, 'imageUrl', "imageUrl") ORDER BY pos) AS images
      FROM ranked
      WHERE pos <= ${MAP_COVERS_PER_COUNTRY}
      GROUP BY country
    ),
    artist_counts AS (
      SELECT a.country, COUNT(*)::text AS artist_count
      FROM "Artist" a
      WHERE a.country IS NOT NULL
        AND a."primaryArtistId" IS NULL
        AND EXISTS (SELECT 1 FROM "LocalReleaseArtist" l WHERE l."artistId" = a.id)
      GROUP BY a.country
    )
    SELECT ac.country, ac.artist_count, cv.images
    FROM artist_counts ac
    JOIN covers cv ON cv.country = ac.country
    ORDER BY ac.artist_count::int DESC, ac.country
  `
