import { Prisma } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'

// Every track an artist owns (on a release they own) or is credited on (TrackRelatedArtist), as ids.
//
// This used to be `findMany({ where: { OR: [{ localRelease: { artists: { some } } }, { trackRelatedArtists:
// { some } }] } })`. Postgres cannot use an index across an OR of two correlated EXISTS, so it planned a
// sequential scan of all 1.9M tracks (cost ~10M) plus a sort - on every "shuffle" click. A UNION of two
// index-backed lookups (LocalReleaseTrack.localReleaseId, TrackRelatedArtist.artistId) touches only the
// artist's own rows.
const artistTrackIdsSql = (artistId: string): Prisma.Sql => Prisma.sql`
  SELECT t.id
  FROM "LocalReleaseArtist" lra
  JOIN "LocalReleaseTrack" t ON t."localReleaseId" = lra."localReleaseId"
  WHERE lra."artistId" = ${artistId}
  UNION
  SELECT tra."trackId" AS id
  FROM "TrackRelatedArtist" tra
  WHERE tra."artistId" = ${artistId}`

// Sanity ceiling on the ordered list: ids go back into an `IN (...)`, and Postgres allows 32,767 bind
// parameters per statement. Well above any real artist (Billie Holiday, the largest here, has ~5,800).
export const ARTIST_TRACK_LIST_CAP = 10_000

export const listArtistTrackIds = async (artistId: string): Promise<string[]> => {
  const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM (${artistTrackIdsSql(artistId)}) u LIMIT ${ARTIST_TRACK_LIST_CAP}`
  return rows.map(r => r.id)
}

export const randomArtistTrackIds = async (artistId: string, n: number): Promise<string[]> => {
  const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM (${artistTrackIdsSql(artistId)}) u ORDER BY random() LIMIT ${n}`
  return rows.map(r => r.id)
}
