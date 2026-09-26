import { Prisma } from '@prisma/client'
import { paged } from '~/server/utils/pagination'
import { db } from '~/server/utils/statementTimeout'
import { escapeLike } from '~/server/utils/searchRank'
import { releaseTypeBucketSql } from '~/server/utils/releaseTypeBuckets'
import { releaseTypeBuckets, playPeriods } from '~/helpers/constants'
import { periodStart } from '~/server/utils/userPlays'
import { resolveTimeZone } from '~/server/utils/timezone'
import type { PlayPeriod } from '~/types/stats'

const RELEASE_TYPE_BUCKET_ID_SET = new Set<string>(releaseTypeBuckets.map(b => b.id))
const PLAY_PERIOD_ID_SET = new Set<string>(playPeriods.map(p => p.id))

export const VALID_TYPES = new Set([
  'artists', 'releases', 'tracks', 'genres', 'plays', 'size', 'recent-plays',
  'artists-synced', 'releases-synced',
  'artists-with-art', 'releases-with-art',
  'unmatched', 'incomplete', 'bitrate', 'single-release', 'shortest', 'missing-art', 'types', 'type-detail',
])

export interface StatArgs {
  userId: number | null
  search: string
  skip: number
  pageSize: number
  page: number
  sort: string
  order: 'asc' | 'desc'
}

export async function runStatQuery(type: string, query: Record<string, unknown>, a: StatArgs) {
  const { search, skip, pageSize, page, sort, order } = a
  switch (type) {
    case 'types':
      return queryReleaseTypesPivot(search, skip, pageSize, page, sort, order)
    case 'type-detail': {
      const bucket = query.bucket as string
      const artist = query.artist as string
      if (!RELEASE_TYPE_BUCKET_ID_SET.has(bucket) || !artist) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid bucket or artist' })
      }
      return queryReleaseTypeDetail(bucket, artist, search, skip, pageSize, page, sort, order)
    }
    case 'artists':
    case 'artists-synced':
    case 'artists-with-art':
      return queryArtists(type, search, skip, pageSize, page, sort, order)
    case 'releases':
    case 'releases-with-art':
      return queryReleases(type, search, skip, pageSize, page, sort, order)
    case 'tracks':
      return queryTracks(search, skip, pageSize, page, sort, order)
    case 'genres':
      return queryGenres(search, skip, pageSize, page, sort, order)
    case 'plays':
      return queryPlays(a.userId!, search, skip, pageSize, page, sort, order)
    case 'recent-plays': {
      const period = query.period as string
      if (!PLAY_PERIOD_ID_SET.has(period)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid period' })
      }
      return queryRecentPlays(a.userId!, period as PlayPeriod, resolveTimeZone(query.tz), search, skip, pageSize, page, sort, order)
    }
    case 'size':
      return querySize(search, skip, pageSize, page, sort, order)
    case 'releases-synced':
      return queryReleasesSynced(search, skip, pageSize, page, sort, order)
    case 'unmatched':
      return queryReleasesByStatus(['UNMATCHED'], search, skip, pageSize, page, sort, order)
    case 'incomplete':
      return queryReleasesByStatus(['INCOMPLETE', 'MISSING_TRACKS'], search, skip, pageSize, page, sort, order)
    case 'bitrate':
      return queryLowBitrate(search, skip, pageSize, page, sort, order)
    case 'single-release':
      return querySingleRelease(search, skip, pageSize, page, sort, order)
    case 'shortest':
      return queryShortest(search, skip, pageSize, page, sort, order)
    case 'missing-art':
      return queryMissingArt(search, skip, pageSize, page, sort, order)
    default:
      throw createError({ statusCode: 400, statusMessage: 'Invalid stat type' })
  }
}

// Shared shaping/SQL helpers for the raw queries below. Everything user-controlled goes in as a bound
// parameter (Prisma.sql); the only interpolated identifiers come from fixed whitelists.
const nameContains = (column: Prisma.Sql, search: string): Prisma.Sql =>
  search ? Prisma.sql`AND ${column} ILIKE ${`%${escapeLike(search)}%`}` : Prisma.empty
const dirSql = (order: 'asc' | 'desc'): Prisma.Sql => (order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`)
const whitelisted = (map: Record<string, string>, key: string, fallback: string): Prisma.Sql => Prisma.raw(map[key] ?? fallback)

// `total` comes from `COUNT(*) OVER()` on the page's own rows. That reads 0 for a page past the end, so an
// empty page re-counts - the only case where the window has nothing to report.
const pageFromRows = async <T extends { total: bigint | number }>(
  rows: T[],
  skip: number,
  countAll: () => Promise<number>,
): Promise<{ items: Omit<T, 'total'>[], total: number }> => {
  const total = rows.length > 0 ? Number(rows[0]!.total) : (skip > 0 ? await countAll() : 0)
  return { items: rows.map(({ total: _t, ...rest }) => rest), total }
}

async function queryArtists(type: string, search: string, skip: number, pageSize: number, page: number, _sort: string, order: 'asc' | 'desc') {
  // Matches artists/index.get.ts's base filter: connected (duplicate) artists are aggregated onto
  // their primary - counting them here inflated the stat beyond what /browse actually lists (audit #82).
  const where: any = { primaryArtistId: null, localReleases: { some: {} } }
  if (search) { where.name = { contains: search, mode: 'insensitive' } }
  if (type === 'artists-synced') { where.musicbrainzId = { not: null } }
  if (type === 'artists-with-art') { where.OR = [{ image: { not: null } }, { imageUrl: { not: null } }] }

  const [items, total] = await Promise.all([
    db().artist.findMany({
      where,
      select: { id: true, name: true, slug: true },
      orderBy: { name: order },
      skip,
      take: pageSize,
    }),
    db().artist.count({ where }),
  ])

  return paged(items.map(a => ({ id: a.id, name: a.name, slug: a.slug })), total, { page, pageSize, skip })
}

async function queryReleases(type: string, search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = {}
  if (search) { where.title = { contains: search, mode: 'insensitive' } }
  if (type === 'releases-with-art') { where.OR = [{ image: { not: null } }, { imageUrl: { not: null } }] }

  const orderBy = sort === 'year' ? { year: order } : { title: order }

  const [items, total] = await Promise.all([
    db().localRelease.findMany({
      where,
      select: {
        id: true,
        title: true,
        year: true,
        artists: {
          take: 1,
          select: { artist: { select: { name: true, slug: true } } },
        },
      },
      orderBy,
      skip,
      take: pageSize,
    }),
    db().localRelease.count({ where }),
  ])

  return paged(items.map(r => ({
      id: r.id,
      title: r.title,
      year: r.year,
      artistName: r.artists[0]?.artist.name ?? null,
      artistSlug: r.artists[0]?.artist.slug ?? null,
    })), total, { page, pageSize, skip })
}

async function queryTracks(search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = {}
  if (search) { where.title = { contains: search, mode: 'insensitive' } }

  const orderBy = sort === 'artist' ? { artist: order } : { title: order }

  const [items, total] = await Promise.all([
    db().localReleaseTrack.findMany({
      where,
      select: { id: true, title: true, artist: true },
      orderBy,
      skip,
      take: pageSize,
    }),
    db().localReleaseTrack.count({ where }),
  ])

  return paged(items.map(t => ({
      id: t.id,
      title: t.title,
      artistName: t.artist,
    })), total, { page, pageSize, skip })
}

async function queryGenres(search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = {}
  if (search) { where.name = { contains: search, mode: 'insensitive' } }

  const orderBy = sort === 'artistCount' ? { artists: { _count: order } } : { name: order }

  const [items, total] = await Promise.all([
    db().genre.findMany({
      where,
      select: {
        id: true,
        name: true,
        _count: { select: { artists: true } },
      },
      orderBy,
      skip,
      take: pageSize,
    }),
    db().genre.count({ where }),
  ])

  return paged(items.map(g => ({
      id: g.id,
      name: g.name,
      artistCount: g._count.artists,
    })), total, { page, pageSize, skip })
}

async function queryPlays(userId: number, search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = { userId, playCount: { gt: 0 } }
  if (search) { where.track = { title: { contains: search, mode: 'insensitive' } } }

  const sortMap: Record<string, any> = {
    title: { track: { title: order } },
    artist: { track: { artist: order } },
  }
  const orderBy = sortMap[sort] ?? { playCount: order }

  const [items, total] = await Promise.all([
    db().localReleaseTrackPlay.findMany({
      where,
      select: { playCount: true, track: { select: { id: true, title: true, artist: true } } },
      orderBy,
      skip,
      take: pageSize,
    }),
    db().localReleaseTrackPlay.count({ where }),
  ])

  return paged(items.map(p => ({
      id: p.track.id,
      title: p.track.title,
      artistName: p.track.artist,
      playCount: p.playCount,
    })), total, { page, pageSize, skip })
}

// Backs the Recent Plays panel's detail subpages (pages/statistics/recent-plays/[period].vue) - the
// individual PlayEvent rows within the period, not the per-track aggregate `queryPlays` above uses.
async function queryRecentPlays(userId: number, period: PlayPeriod, timeZone: string, search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = { userId, counted: true, startedAt: { gte: periodStart(period, new Date(), timeZone) } }
  if (search) { where.track = { title: { contains: search, mode: 'insensitive' } } }

  const sortMap: Record<string, any> = {
    title: { track: { title: order } },
    artist: { track: { artist: order } },
    playedAt: { startedAt: order },
  }
  const orderBy = sortMap[sort] ?? { startedAt: 'desc' }

  const [items, total] = await Promise.all([
    db().playEvent.findMany({
      where,
      select: { id: true, startedAt: true, track: { select: { id: true, title: true, artist: true } } },
      orderBy,
      skip,
      take: pageSize,
    }),
    db().playEvent.count({ where }),
  ])

  return paged(items.map(p => ({
      id: p.id,
      title: p.track.title,
      artistName: p.track.artist,
      playedAt: p.startedAt,
    })), total, { page, pageSize, skip })
}

async function querySize(search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const orderColumn = whitelisted({ name: 'a."name"', totalSize: '"totalSize"' }, sort, '"totalSize"')
  const dir = dirSql(order)

  // Sizes come from the denormalized LocalRelease.totalFileSize (kept by index) instead of joining and summing
  // every one of the 1.9M LocalReleaseTrack rows twice (once to count, once for the page). Connected duplicate
  // artists roll up onto their primary like every other artist stat; DISTINCT stops a release owned by both a
  // primary and its duplicate from counting twice.
  const rows = await db().$queryRaw<{ id: string, name: string, slug: string, totalSize: bigint, total: bigint }[]>`
    SELECT a.id, a."name", a."slug", SUM(x."totalFileSize") AS "totalSize", COUNT(*) OVER() AS total
    FROM (
      SELECT DISTINCT COALESCE(src."primaryArtistId", src.id) AS artist_id, lr.id AS release_id, lr."totalFileSize"
      FROM "LocalReleaseArtist" lra
      JOIN "Artist" src ON src.id = lra."artistId"
      JOIN "LocalRelease" lr ON lr.id = lra."localReleaseId"
      WHERE lr."totalFileSize" > 0
    ) x
    JOIN "Artist" a ON a.id = x.artist_id
    WHERE TRUE ${nameContains(Prisma.sql`a."name"`, search)}
    GROUP BY a.id, a."name", a."slug"
    ORDER BY ${orderColumn} ${dir}, a.id
    OFFSET ${skip} LIMIT ${pageSize}
  `
  const { items, total } = await pageFromRows(rows, skip, async () => {
    const [r] = await db().$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(DISTINCT COALESCE(src."primaryArtistId", src.id)) AS n
      FROM "LocalReleaseArtist" lra
      JOIN "Artist" src ON src.id = lra."artistId"
      JOIN "LocalRelease" lr ON lr.id = lra."localReleaseId" AND lr."totalFileSize" > 0
      JOIN "Artist" a ON a.id = COALESCE(src."primaryArtistId", src.id)
      WHERE TRUE ${nameContains(Prisma.sql`a."name"`, search)}`
    return Number(r?.n ?? 0)
  })

  return paged(items.map(r => ({ id: r.id, name: r.name, slug: r.slug, totalSize: Number(r.totalSize) })), total, { page, pageSize, skip })
}

async function queryReleasesByStatus(statuses: string[], search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = { matchStatus: { in: statuses } }
  if (search) { where.title = { contains: search, mode: 'insensitive' } }

  const sortMap: Record<string, any> = { year: { year: order }, matchStatus: { matchStatus: order } }
  const orderBy = sortMap[sort] ?? { title: order }

  const [items, total] = await Promise.all([
    db().localRelease.findMany({
      where,
      select: {
        id: true,
        title: true,
        year: true,
        matchStatus: true,
        artists: { take: 1, select: { artist: { select: { name: true, slug: true } } } },
      },
      orderBy,
      skip,
      take: pageSize,
    }),
    db().localRelease.count({ where }),
  ])

  return paged(items.map(r => ({
      id: r.id,
      title: r.title,
      year: r.year,
      matchStatus: r.matchStatus,
      artistName: r.artists[0]?.artist.name ?? null,
      artistSlug: r.artists[0]?.artist.slug ?? null,
    })), total, { page, pageSize, skip })
}

async function queryLowBitrate(search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = { bitrate: { lt: 256, gt: 0 } }
  if (search) { where.title = { contains: search, mode: 'insensitive' } }

  const sortMap: Record<string, any> = { title: { title: order }, artist: { artist: order } }
  const orderBy = sortMap[sort] ?? { bitrate: order }

  const [items, total] = await Promise.all([
    db().localReleaseTrack.findMany({
      where,
      select: { id: true, title: true, artist: true, bitrate: true },
      orderBy,
      skip,
      take: pageSize,
    }),
    db().localReleaseTrack.count({ where }),
  ])

  return paged(items.map(t => ({
      id: t.id,
      title: t.title,
      artistName: t.artist,
      bitrate: t.bitrate,
    })), total, { page, pageSize, skip })
}

async function querySingleRelease(search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const orderColumn = whitelisted({ name: 'x."name"', totalSize: 'x."totalSize"', trackCount: 'x."trackCount"' }, sort, 'x."totalSize"')
  const dir = dirSql(order)

  // Artists (primaries only) that own exactly one release. Size is the denormalized LocalRelease.totalFileSize;
  // the track count is a correlated index lookup per candidate rather than a join over every track.
  const rows = await db().$queryRaw<{ id: string, name: string, slug: string, releaseTitle: string, trackCount: bigint, totalSize: bigint, total: bigint }[]>`
    SELECT x.*, COUNT(*) OVER() AS total FROM (
      SELECT a.id, a."name", a."slug", lr."title" AS "releaseTitle", lr."totalFileSize" AS "totalSize",
             (SELECT COUNT(*) FROM "LocalReleaseTrack" t WHERE t."localReleaseId" = lr.id) AS "trackCount"
      FROM (
        SELECT lra."artistId", MIN(lra."localReleaseId") AS release_id
        FROM "LocalReleaseArtist" lra
        GROUP BY lra."artistId"
        HAVING COUNT(DISTINCT lra."localReleaseId") = 1
      ) s
      JOIN "Artist" a ON a.id = s."artistId" AND a."primaryArtistId" IS NULL
      JOIN "LocalRelease" lr ON lr.id = s.release_id
      WHERE TRUE ${nameContains(Prisma.sql`a."name"`, search)}
    ) x
    ORDER BY ${orderColumn} ${dir}, x.id
    OFFSET ${skip} LIMIT ${pageSize}
  `
  const { items, total } = await pageFromRows(rows, skip, async () => {
    const [r] = await db().$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM (
        SELECT lra."artistId" FROM "LocalReleaseArtist" lra GROUP BY lra."artistId" HAVING COUNT(DISTINCT lra."localReleaseId") = 1
      ) s
      JOIN "Artist" a ON a.id = s."artistId" AND a."primaryArtistId" IS NULL
      WHERE TRUE ${nameContains(Prisma.sql`a."name"`, search)}`
    return Number(r?.n ?? 0)
  })

  return paged(items.map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      releaseTitle: r.releaseTitle,
      trackCount: Number(r.trackCount),
      totalSize: Number(r.totalSize),
    })), total, { page, pageSize, skip })
}

async function queryShortest(search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = {}
  if (search) { where.title = { contains: search, mode: 'insensitive' } }

  const sortMap: Record<string, any> = { title: { title: order } }
  const orderBy = sortMap[sort] ?? { totalDuration: order }

  const [items, total] = await Promise.all([
    db().localRelease.findMany({
      where,
      select: {
        id: true,
        title: true,
        totalDuration: true,
        artists: { take: 1, select: { artist: { select: { name: true, slug: true } } } },
        _count: { select: { tracks: true } },
      },
      orderBy,
      skip,
      take: pageSize,
    }),
    db().localRelease.count({ where }),
  ])

  return paged(items.map(r => ({
      id: r.id,
      title: r.title,
      totalDuration: r.totalDuration,
      trackCount: r._count.tracks,
      artistName: r.artists[0]?.artist.name ?? null,
      artistSlug: r.artists[0]?.artist.slug ?? null,
    })), total, { page, pageSize, skip })
}

async function queryMissingArt(search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = { image: null, imageUrl: null }
  if (search) { where.title = { contains: search, mode: 'insensitive' } }

  const orderBy = sort === 'year' ? { year: order } : { title: order }

  const [items, total] = await Promise.all([
    db().localRelease.findMany({
      where,
      select: {
        id: true,
        title: true,
        year: true,
        artists: { take: 1, select: { artist: { select: { name: true, slug: true } } } },
      },
      orderBy,
      skip,
      take: pageSize,
    }),
    db().localRelease.count({ where }),
  ])

  return paged(items.map(r => ({
      id: r.id,
      title: r.title,
      year: r.year,
      artistName: r.artists[0]?.artist.name ?? null,
      artistSlug: r.artists[0]?.artist.slug ?? null,
    })), total, { page, pageSize, skip })
}

async function queryReleasesSynced(search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = {}
  if (search) { where.title = { contains: search, mode: 'insensitive' } }

  const orderBy = sort === 'year' ? { year: order } : { title: order }

  const [items, total] = await Promise.all([
    db().musicBrainzRelease.findMany({
      where,
      select: {
        id: true,
        title: true,
        year: true,
        artists: { take: 1, select: { artist: { select: { name: true, slug: true } } } },
      },
      orderBy,
      skip,
      take: pageSize,
    }),
    db().musicBrainzRelease.count({ where }),
  ])

  return paged(items.map(r => ({
      id: r.id,
      title: r.title,
      year: r.year,
      artistName: r.artists[0]?.artist.name ?? 'Unknown',
      artistSlug: r.artists[0]?.artist.slug ?? '',
    })), total, { page, pageSize, skip })
}

// Release Types (pages/statistics/types.vue): one row per artist, one column per bucket - a single
// pivoted table instead of a tab per bucket, since the whole vocabulary is only 8 buckets. Connected
// (duplicate) artists roll up onto their primary, same convention as queryArtists's "Linked artists"
// note above. releaseTypeBuckets (helpers/constants.ts) drives the column list so a new bucket only
// needs adding there and to releaseTypeBucketSql's CASE.
const RELEASE_TYPE_BUCKET_IDS = releaseTypeBuckets.map(b => b.id)

async function queryReleaseTypesPivot(search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  // Bucket ids come from a fixed constant list (helpers/constants.ts), never from the request.
  const bucketColumns = Prisma.join(
    RELEASE_TYPE_BUCKET_IDS.map(id => Prisma.sql`COUNT(*) FILTER (WHERE rb.bucket = ${id})::int AS ${Prisma.raw(`"${id}"`)}`),
    ',\n      ',
  )
  const orderMap: Record<string, string> = { name: 'p."name"' }
  for (const id of RELEASE_TYPE_BUCKET_IDS) { orderMap[id] = `p."${id}"` }
  const orderColumn = whitelisted(orderMap, sort, 'p."name"')
  const dir = dirSql(order)

  // One pass: the CTE is evaluated once and the total rides along as a window count over the grouped rows (it
  // used to be computed twice, once for the count and again for the page).
  const rows = await db().$queryRaw<Record<string, any>[]>`
    WITH release_buckets AS (
      SELECT lra."artistId", ${Prisma.raw(releaseTypeBucketSql)} AS bucket
      FROM "LocalRelease" lr
      JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
      LEFT JOIN "MusicBrainzRelease" mb ON mb.id = lr."releaseId"
      LEFT JOIN "ReleaseType" rt ON rt.id = mb."typeId"
    )
    SELECT p.*, COUNT(*) OVER() AS total FROM (
      SELECT a2.id, a2."name", a2."slug",
        ${bucketColumns}
      FROM release_buckets rb
      JOIN "Artist" a ON a.id = rb."artistId"
      JOIN "Artist" a2 ON a2.id = COALESCE(a."primaryArtistId", a.id)
      WHERE TRUE ${nameContains(Prisma.sql`a2."name"`, search)}
      GROUP BY a2.id, a2."name", a2."slug"
    ) p
    ORDER BY ${orderColumn} ${dir}, p.id
    OFFSET ${skip} LIMIT ${pageSize}
  `
  const { items, total } = await pageFromRows(rows as (Record<string, any> & { total: bigint })[], skip, async () => {
    const [r] = await db().$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(DISTINCT a2.id) AS n
      FROM "LocalReleaseArtist" lra
      JOIN "Artist" a ON a.id = lra."artistId"
      JOIN "Artist" a2 ON a2.id = COALESCE(a."primaryArtistId", a.id)
      WHERE TRUE ${nameContains(Prisma.sql`a2."name"`, search)}`
    return Number(r?.n ?? 0)
  })

  return paged(items.map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      ...Object.fromEntries(RELEASE_TYPE_BUCKET_IDS.map(id => [id, r[id]])),
    })), total, { page, pageSize, skip })
}

// Release Types drill-down (pages/statistics/types/[bucket].vue): one artist's releases within one
// bucket - "Britney Spears' Singles" - reached by clicking a nonzero cell in the pivoted table above.
// Matches both the given artist and any artist rolled onto it via primaryArtistId (a TypesPage.vue
// row is already the *primary* artist, so its duplicates' own releases belong on this list too).
async function queryReleaseTypeDetail(bucket: string, artistSlug: string, search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const artist = await db().artist.findUnique({ where: { slug: artistSlug }, select: { id: true } })
  if (!artist) {
    throw createError({ statusCode: 404, statusMessage: 'Artist not found' })
  }

  const orderColumn = whitelisted({ title: 'lr."title"', year: 'lr."year"', updatedAt: 'lr."updatedAt"' }, sort, 'lr."year"')
  const dir = dirSql(order)
  const scope = Prisma.sql`
    FROM "LocalRelease" lr
    JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
    JOIN "Artist" a ON a.id = lra."artistId"
    LEFT JOIN "MusicBrainzRelease" mb ON mb.id = lr."releaseId"
    LEFT JOIN "ReleaseType" rt ON rt.id = mb."typeId"
    WHERE (${Prisma.raw(releaseTypeBucketSql)}) = ${bucket} AND (a.id = ${artist.id} OR a."primaryArtistId" = ${artist.id}) ${nameContains(Prisma.sql`lr."title"`, search)}`

  const [countResult, rows] = await Promise.all([
    db().$queryRaw<[{ count: bigint }]>`SELECT COUNT(DISTINCT lr.id)::bigint AS count ${scope}`,
    db().$queryRaw<{ id: string, title: string, year: number | null, updatedAt: Date | string | null }[]>`
      SELECT DISTINCT lr.id, lr."title", lr."year", lr."updatedAt" ${scope}
      ORDER BY ${orderColumn} ${dir}
      OFFSET ${skip} LIMIT ${pageSize}`,
  ])
  const total = Number(countResult[0].count)

  return paged(rows.map(r => ({ id: r.id, title: r.title, year: r.year, updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null })), total, { page, pageSize, skip })
}
