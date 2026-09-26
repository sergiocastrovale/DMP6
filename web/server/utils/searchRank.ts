import { Prisma } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import { RELEASE_TILE_SELECT_NO_GENRE, toReleaseTile } from '~/server/utils/releaseTiles'
import { SEARCH_MIN_CHARS, SEARCH_TIER_CAP, SEARCH_TOTAL_CAP } from '~/helpers/constants'

// Escapes LIKE/ILIKE metacharacters so a query containing %, _ or \ is matched literally instead
// of being treated as a wildcard.
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, char => `\\${char}`)

export interface RankedIds {
  ids: string[]
  // Capped at SEARCH_TOTAL_CAP: counting every match of a common word ("the", "love") would read
  // hundreds of thousands of rows just to print a badge. `totalCapped` means "at least this many".
  total: number
  totalCapped: boolean
}

export type SearchKind = 'artists' | 'releases' | 'tracks'

const EMPTY: RankedIds = { ids: [], total: 0, totalCapped: false }

// Rank tiers, most specific first: exact, prefix, word-boundary, plain substring. Keeps "HIM" from being
// buried under every artist whose name merely contains "him". Each tier is capped independently, so a
// common word costs a bounded number of heap fetches rather than a sort of every match.
export const searchPatterns = (q: string): [string, string, string, string] => {
  const e = escapeLike(q)
  return [e, `${e}%`, `% ${e}%`, `%${e}%`]
}

const TIER_EXACT = 0
const TIER_PREFIX = 1

// `col` matches tier `tier` of the query. Track titles answer the exact and prefix tiers from the btree on
// lower(title) (migration 20260926000500) - the trigram index can't reject a non-match without fetching
// every candidate row. Everything else, and the two substring tiers, use the trigram indexes.
const tierCondition = (kind: SearchKind, col: Prisma.Sql, tier: number, q: string): Prisma.Sql => {
  const pattern = searchPatterns(q)[tier]!
  if (kind === 'tracks' && tier === TIER_EXACT) {
    return Prisma.sql`lower(${col}) = lower(${q})`
  }
  if (kind === 'tracks' && tier === TIER_PREFIX) {
    return Prisma.sql`lower(${col}) LIKE lower(${escapeLike(q)}) || '%'`
  }
  return Prisma.sql`${col} ILIKE ${pattern}`
}

// One SELECT of (id, label, k1) for every row matching the tier. `label` is the text shown and tie-broken
// on; `k1` is a per-kind popularity key sorted DESC inside a tier.
const matchRows = (kind: SearchKind, tier: number, q: string): Prisma.Sql => {
  switch (kind) {
    case 'artists':
      return Prisma.sql`
        SELECT id, name AS label, COALESCE(completeness, -1)::float8 AS k1
        FROM "Artist"
        WHERE "primaryArtistId" IS NULL AND ${tierCondition(kind, Prisma.sql`name`, tier, q)}`
    case 'tracks':
      return Prisma.sql`
        SELECT id, title AS label, 0::float8 AS k1
        FROM "LocalReleaseTrack"
        WHERE ${tierCondition(kind, Prisma.sql`title`, tier, q)}`
    case 'releases':
      // A release matches on its own folder-derived title or on the MusicBrainz title it is bound to.
      // Two indexed branches instead of one OR across a join, which no index can serve.
      return Prisma.sql`
        SELECT lr.id, lr.title AS label, extract(epoch FROM lr."createdAt")::float8 AS k1
        FROM "LocalRelease" lr
        WHERE ${tierCondition(kind, Prisma.sql`lr.title`, tier, q)}
        UNION
        SELECT lr.id, lr.title AS label, extract(epoch FROM lr."createdAt")::float8 AS k1
        FROM "LocalRelease" lr
        JOIN "MusicBrainzRelease" mbr ON mbr.id = lr."releaseId"
        WHERE ${tierCondition(kind, Prisma.sql`mbr.title`, tier, q)}`
  }
}

export const rankedIds = async (kind: SearchKind, rawQuery: string, skip: number, take: number): Promise<RankedIds> => {
  const q = rawQuery.trim()
  if (q.length < SEARCH_MIN_CHARS[kind]) {
    return EMPTY
  }
  const tierCap = Math.max(SEARCH_TIER_CAP, skip + take)

  const [rows, counted] = await Promise.all([
    prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM (
        SELECT DISTINCT ON (id) id, label, k1, tier FROM (
          (SELECT id, label, k1, 0 AS tier FROM (${matchRows(kind, 0, q)}) t0 LIMIT ${tierCap})
          UNION ALL
          (SELECT id, label, k1, 1 AS tier FROM (${matchRows(kind, 1, q)}) t1 LIMIT ${tierCap})
          UNION ALL
          (SELECT id, label, k1, 2 AS tier FROM (${matchRows(kind, 2, q)}) t2 LIMIT ${tierCap})
          UNION ALL
          (SELECT id, label, k1, 3 AS tier FROM (${matchRows(kind, 3, q)}) t3 LIMIT ${tierCap})
        ) u
        ORDER BY id, tier
      ) d
      ORDER BY tier, k1 DESC, label, id
      OFFSET ${skip} LIMIT ${take}`,
    prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM (SELECT 1 FROM (${matchRows(kind, 3, q)}) m LIMIT ${SEARCH_TOTAL_CAP + 1}) s`,
  ])

  const n = counted[0]?.n ?? 0
  return { ids: rows.map(r => r.id), total: Math.min(n, SEARCH_TOTAL_CAP), totalCapped: n > SEARCH_TOTAL_CAP }
}

export const rankedArtistIds = (q: string, skip: number, take: number): Promise<RankedIds> => rankedIds('artists', q, skip, take)
export const rankedReleaseIds = (q: string, skip: number, take: number): Promise<RankedIds> => rankedIds('releases', q, skip, take)
export const rankedTrackIds = (q: string, skip: number, take: number): Promise<RankedIds> => rankedIds('tracks', q, skip, take)

// Row shaping shared by the dropdown endpoint and the paged per-type endpoint, so the two can
// never drift on fields/image handling.
export const hydrateArtists = async (ids: string[]) => {
  if (!ids.length) {return []}
  const rows = await prisma.artist.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      name: true,
      slug: true,
      image: true,
      imageUrl: true,
      // Capped at the source: only ever need the first 3 for the "max 3, ellipsis" display, so
      // there's no reason to pull an artist's full genre list over the wire.
      genres: { select: { name: true }, take: 3 },
    },
  })
  const byId = new Map(rows.map(r => [r.id, r]))
  return ids.map(id => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r).map(artist => ({
    id: artist.id,
    name: artist.name,
    slug: artist.slug,
    genres: artist.genres.map(g => g.name),
    ...verifyImage(artist.image, artist.imageUrl, 'artists'),
  }))
}

export const hydrateReleases = async (ids: string[]) => {
  if (!ids.length) {return []}
  const rows = await prisma.localRelease.findMany({
    where: { id: { in: ids } },
    select: RELEASE_TILE_SELECT_NO_GENRE,
  })
  const byId = new Map(rows.map(r => [r.id, r]))
  return ids.map(id => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r).map((release) => {
    const { genre: _genre, musicBrainzId: _mb, ...tile } = toReleaseTile(release)
    return tile
  })
}

export const hydrateTracks = async (ids: string[]) => {
  if (!ids.length) {return []}
  // Explicit `select` down every level - a plain `include` defaults to every scalar column
  // (timestamps, tag metadata, file paths...) on both LocalReleaseTrack and the nested
  // LocalRelease, none of which the dropdown/results row needs.
  const rows = await prisma.localReleaseTrack.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      title: true,
      trackNumber: true,
      duration: true,
      localRelease: {
        select: {
          id: true,
          title: true,
          year: true,
          image: true,
          imageUrl: true,
          artists: { select: { artist: { select: { id: true, name: true, slug: true } } } },
        },
      },
    },
  })
  const byId = new Map(rows.map(r => [r.id, r]))
  return ids.map(id => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r).map(track => ({
    id: track.id,
    title: track.title ?? '',
    trackNumber: track.trackNumber,
    duration: track.duration,
    release: track.localRelease
      ? {
          id: track.localRelease.id,
          title: track.localRelease.title,
          year: track.localRelease.year,
          ...verifyImage(track.localRelease.image, track.localRelease.imageUrl, 'releases'),
          artist: track.localRelease.artists[0]?.artist ?? null,
        }
      : null,
  }))
}
