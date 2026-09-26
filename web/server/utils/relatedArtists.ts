import { prisma } from '~/server/utils/prisma'
import { RELATED_ARTISTS_LIMIT } from '~/helpers/constants'

export interface RelatedArtistRow {
  id: string
  name: string
  slug: string
  image: string | null
  imageUrl: string | null
}

// Artists credited on tracks of releases this artist owns, most frequent collaborators first. Bounded: a
// compilation-heavy artist has hundreds of one-off credits and the page only shows the top of them.
export const fetchRelatedArtists = (artistId: string, limit: number = RELATED_ARTISTS_LIMIT): Promise<RelatedArtistRow[]> =>
  prisma.$queryRaw<RelatedArtistRow[]>`
    SELECT a.id, a.name, a.slug, a.image, a."imageUrl"
    FROM "TrackRelatedArtist" tra
    JOIN "LocalReleaseTrack" lrt ON lrt.id = tra."trackId"
    JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lrt."localReleaseId"
    JOIN "Artist" a ON a.id = tra."artistId"
    WHERE lra."artistId" = ${artistId}
      AND tra."artistId" <> ${artistId}
    GROUP BY a.id
    ORDER BY count(*) DESC, a.name ASC
    LIMIT ${limit}
  `
