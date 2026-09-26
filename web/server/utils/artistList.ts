import { Prisma } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import { escapeLike } from '~/server/utils/searchRank'

// The browse list's filters, expressed twice: as a Prisma `where` (the normal, cached path) and as raw SQL
// conditions (the two sorts Prisma can't express - by release count and by this user's plays - both need a
// join-aggregate to ORDER BY). `artistListWhere` and `artistListConditions` must select the same artists;
// test/integration/routes/artistList.test.ts asserts it.
export interface ArtistListFilters {
  letter: string | null
  search: string | null
  genres: string[]
  // Fractions (0..1) - the route converts from the 0..100 query params.
  minCompleteness: number | null
  maxCompleteness: number | null
}

// Credit-only artists (MB-verified 'appears on' entries that own no release) have their own page and are
// searchable, but must not appear in browse. Ownership is normally derived, never a stored flag - except
// `manuallyAdded` (./add, CLAUDE.md Data Model), which lets an artist added before owning any files show up.
export const artistListWhere = (f: ArtistListFilters): Prisma.ArtistWhereInput => ({
  primaryArtistId: null,
  OR: [{ localReleases: { some: {} } }, { manuallyAdded: true }],
  ...(f.letter ? { slug: { startsWith: f.letter } } : {}),
  ...(f.search ? { name: { contains: f.search, mode: 'insensitive' as const } } : {}),
  // OR semantics - an artist matches if tagged with any of the checked genres.
  ...(f.genres.length ? { genres: { some: { name: { in: f.genres } } } } : {}),
  ...(f.minCompleteness !== null || f.maxCompleteness !== null
    ? {
        completeness: {
          ...(f.minCompleteness !== null ? { gte: f.minCompleteness } : {}),
          ...(f.maxCompleteness !== null ? { lte: f.maxCompleteness } : {}),
        },
      }
    : {}),
})

// `a` is the "Artist" alias. `_ArtistGenres`."A" is the artist id and "B" the genre id (Prisma orders an
// implicit many-to-many's columns alphabetically by model name).
export const artistListConditions = (f: ArtistListFilters): Prisma.Sql[] => [
  Prisma.sql`a."primaryArtistId" IS NULL`,
  Prisma.sql`(EXISTS (SELECT 1 FROM "LocalReleaseArtist" l WHERE l."artistId" = a.id) OR a."manuallyAdded")`,
  ...(f.letter ? [Prisma.sql`a.slug LIKE ${`${escapeLike(f.letter)}%`}`] : []),
  ...(f.search ? [Prisma.sql`a.name ILIKE ${`%${escapeLike(f.search)}%`}`] : []),
  ...(f.genres.length
    ? [Prisma.sql`EXISTS (SELECT 1 FROM "_ArtistGenres" ag JOIN "Genre" g ON g.id = ag."B" WHERE ag."A" = a.id AND g.name = ANY(${f.genres}::text[]))`]
    : []),
  ...(f.minCompleteness !== null ? [Prisma.sql`a.completeness >= ${f.minCompleteness}`] : []),
  ...(f.maxCompleteness !== null ? [Prisma.sql`a.completeness <= ${f.maxCompleteness}`] : []),
]

export type SqlSort = 'releases' | 'playCount'

export interface RankedArtistPage {
  ids: string[]
  total: number
}

// One page of artists ordered by a computed metric, done in the database. The previous implementation loaded
// EVERY matching artist plus every one of their release links (tens of thousands of rows) on each request,
// sorted in JS and sliced the page - the artist with the most releases could not be found any other way, but
// it doesn't need to leave the database to be found. Ties fall back to slug ascending, as before.
export const rankedArtistPage = async (
  filters: ArtistListFilters,
  sort: SqlSort,
  direction: 'asc' | 'desc',
  userId: number,
  skip: number,
  take: number,
): Promise<RankedArtistPage> => {
  const where = Prisma.join(artistListConditions(filters), ' AND ')
  const dir = direction === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`

  const [rows, counted] = await Promise.all([
    sort === 'releases'
      ? prisma.$queryRaw<{ id: string }[]>`
          SELECT a.id
          FROM "Artist" a
          LEFT JOIN "LocalReleaseArtist" lra ON lra."artistId" = a.id
          WHERE ${where}
          GROUP BY a.id, a.slug
          ORDER BY COUNT(lra."localReleaseId") ${dir}, a.slug ASC
          OFFSET ${skip} LIMIT ${take}`
      : prisma.$queryRaw<{ id: string }[]>`
          SELECT a.id
          FROM "Artist" a
          LEFT JOIN (
            SELECT lra."artistId", SUM(p."playCount") AS plays
            FROM "LocalReleaseTrackPlay" p
            JOIN "LocalReleaseTrack" t ON t.id = p."trackId"
            JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = t."localReleaseId"
            WHERE p."userId" = ${userId}
            GROUP BY lra."artistId"
          ) pc ON pc."artistId" = a.id
          WHERE ${where}
          ORDER BY COALESCE(pc.plays, 0) ${dir}, a.slug ASC
          OFFSET ${skip} LIMIT ${take}`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM "Artist" a WHERE ${where}`,
  ])

  return { ids: rows.map(r => r.id), total: Number(counted[0]?.n ?? 0) }
}

// Release count per artist for one page of ids: a GROUP BY the database does, not a fetch of every link row.
export const releaseCountsByArtist = async (artistIds: string[]): Promise<Map<string, number>> => {
  if (artistIds.length === 0) {return new Map()}
  const rows = await prisma.localReleaseArtist.groupBy({
    by: ['artistId'],
    where: { artistId: { in: artistIds } },
    _count: { _all: true },
  })
  return new Map(rows.map(r => [r.artistId, r._count._all]))
}
