import { prisma } from '~/server/utils/prisma'
import { parsePagination } from '~/server/utils/pagination'
import { releaseTypeBucketSql } from '~/server/utils/releaseTypeBuckets'
import { releaseTypeBuckets, playPeriods } from '~/helpers/constants'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { periodStart } from '~/server/utils/userPlays'
import type { PlayPeriod } from '~/types/stats'

const RELEASE_TYPE_BUCKET_ID_SET = new Set<string>(releaseTypeBuckets.map(b => b.id))
const PLAY_PERIOD_ID_SET = new Set<string>(playPeriods.map(p => p.id))

const VALID_TYPES = new Set([
  'artists', 'releases', 'tracks', 'genres', 'plays', 'size', 'recent-plays',
  'artists-synced', 'releases-synced',
  'artists-with-art', 'releases-with-art',
  'unmatched', 'incomplete', 'bitrate', 'single-release', 'shortest', 'missing-art', 'types', 'type-detail',
])

export default defineEventHandler(async (event) => {
  const type = getRouterParam(event, 'type')
  if (!type || !VALID_TYPES.has(type)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid stat type' })
  }

  const query = getQuery(event)
  const { page, pageSize, skip } = parsePagination(query, { defaultSize: 200, maxSize: 200 })
  const search = (query.search as string)?.trim() || ''
  const sort = (query.sort as string) || ''
  const order = ((query.order as string) === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc'

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
      return queryPlays(currentUserId(event), search, skip, pageSize, page, sort, order)
    case 'recent-plays': {
      const period = query.period as string
      if (!PLAY_PERIOD_ID_SET.has(period)) {
        throw createError({ statusCode: 400, statusMessage: 'Invalid period' })
      }
      return queryRecentPlays(currentUserId(event), period as PlayPeriod, search, skip, pageSize, page, sort, order)
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
})

async function queryArtists(type: string, search: string, skip: number, pageSize: number, page: number, _sort: string, order: 'asc' | 'desc') {
  // Matches artists/index.get.ts's base filter: connected (duplicate) artists are aggregated onto
  // their primary - counting them here inflated the stat beyond what /browse actually lists (audit #82).
  const where: any = { primaryArtistId: null, localReleases: { some: {} } }
  if (search) { where.name = { contains: search, mode: 'insensitive' } }
  if (type === 'artists-synced') { where.musicbrainzId = { not: null } }
  if (type === 'artists-with-art') { where.OR = [{ image: { not: null } }, { imageUrl: { not: null } }] }

  const [items, total] = await Promise.all([
    prisma.artist.findMany({
      where,
      select: { id: true, name: true, slug: true },
      orderBy: { name: order },
      skip,
      take: pageSize,
    }),
    prisma.artist.count({ where }),
  ])

  return {
    items: items.map(a => ({ id: a.id, name: a.name, slug: a.slug })),
    total,
    page,
    pageSize,
    hasMore: skip + pageSize < total,
  }
}

async function queryReleases(type: string, search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = {}
  if (search) { where.title = { contains: search, mode: 'insensitive' } }
  if (type === 'releases-with-art') { where.OR = [{ image: { not: null } }, { imageUrl: { not: null } }] }

  const orderBy = sort === 'year' ? { year: order } : { title: order }

  const [items, total] = await Promise.all([
    prisma.localRelease.findMany({
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
    prisma.localRelease.count({ where }),
  ])

  return {
    items: items.map(r => ({
      id: r.id,
      title: r.title,
      year: r.year,
      artistName: r.artists[0]?.artist.name ?? null,
      artistSlug: r.artists[0]?.artist.slug ?? null,
    })),
    total,
    page,
    pageSize,
    hasMore: skip + pageSize < total,
  }
}

async function queryTracks(search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = {}
  if (search) { where.title = { contains: search, mode: 'insensitive' } }

  const orderBy = sort === 'artist' ? { artist: order } : { title: order }

  const [items, total] = await Promise.all([
    prisma.localReleaseTrack.findMany({
      where,
      select: { id: true, title: true, artist: true },
      orderBy,
      skip,
      take: pageSize,
    }),
    prisma.localReleaseTrack.count({ where }),
  ])

  return {
    items: items.map(t => ({
      id: t.id,
      title: t.title,
      artistName: t.artist,
    })),
    total,
    page,
    pageSize,
    hasMore: skip + pageSize < total,
  }
}

async function queryGenres(search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = {}
  if (search) { where.name = { contains: search, mode: 'insensitive' } }

  const orderBy = sort === 'artistCount' ? { artists: { _count: order } } : { name: order }

  const [items, total] = await Promise.all([
    prisma.genre.findMany({
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
    prisma.genre.count({ where }),
  ])

  return {
    items: items.map(g => ({
      id: g.id,
      name: g.name,
      artistCount: g._count.artists,
    })),
    total,
    page,
    pageSize,
    hasMore: skip + pageSize < total,
  }
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
    prisma.localReleaseTrackPlay.findMany({
      where,
      select: { playCount: true, track: { select: { id: true, title: true, artist: true } } },
      orderBy,
      skip,
      take: pageSize,
    }),
    prisma.localReleaseTrackPlay.count({ where }),
  ])

  return {
    items: items.map(p => ({
      id: p.track.id,
      title: p.track.title,
      artistName: p.track.artist,
      playCount: p.playCount,
    })),
    total,
    page,
    pageSize,
    hasMore: skip + pageSize < total,
  }
}

// Backs the Recent Plays panel's detail subpages (pages/statistics/recent-plays/[period].vue) - the
// individual PlayEvent rows within the period, not the per-track aggregate `queryPlays` above uses.
async function queryRecentPlays(userId: number, period: PlayPeriod, search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = { userId, counted: true, startedAt: { gte: periodStart(period) } }
  if (search) { where.track = { title: { contains: search, mode: 'insensitive' } } }

  const sortMap: Record<string, any> = {
    title: { track: { title: order } },
    artist: { track: { artist: order } },
    playedAt: { startedAt: order },
  }
  const orderBy = sortMap[sort] ?? { startedAt: 'desc' }

  const [items, total] = await Promise.all([
    prisma.playEvent.findMany({
      where,
      select: { id: true, startedAt: true, track: { select: { id: true, title: true, artist: true } } },
      orderBy,
      skip,
      take: pageSize,
    }),
    prisma.playEvent.count({ where }),
  ])

  return {
    items: items.map(p => ({
      id: p.id,
      title: p.track.title,
      artistName: p.track.artist,
      playedAt: p.startedAt,
    })),
    total,
    page,
    pageSize,
    hasMore: skip + pageSize < total,
  }
}

async function querySize(search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const searchClause = search ? `AND a."name" ILIKE '%' || $1 || '%'` : ''
  const params = search ? [search] : []

  const orderColumnMap: Record<string, string> = { name: 'a."name"', totalSize: '"totalSize"' }
  const orderColumn = orderColumnMap[sort] ?? '"totalSize"'
  const orderDir = order === 'asc' ? 'ASC' : 'DESC'

  const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(`
    SELECT COUNT(*)::bigint AS count FROM (
      SELECT a.id
      FROM "Artist" a
      JOIN "LocalReleaseArtist" lra ON lra."artistId" = a.id
      JOIN "LocalRelease" lr ON lr.id = lra."localReleaseId"
      JOIN "LocalReleaseTrack" lrt ON lrt."localReleaseId" = lr.id
      WHERE lrt."fileSize" IS NOT NULL ${searchClause}
      GROUP BY a.id
    ) sub
  `, ...params)

  const total = Number(countResult[0].count)

  const offsetParam = search ? '$2' : '$1'
  const limitParam = search ? '$3' : '$2'

  const rows = await prisma.$queryRawUnsafe<{ id: string; name: string; slug: string; totalSize: bigint }[]>(`
    SELECT a.id, a."name", a."slug", SUM(lrt."fileSize") AS "totalSize"
    FROM "Artist" a
    JOIN "LocalReleaseArtist" lra ON lra."artistId" = a.id
    JOIN "LocalRelease" lr ON lr.id = lra."localReleaseId"
    JOIN "LocalReleaseTrack" lrt ON lrt."localReleaseId" = lr.id
    WHERE lrt."fileSize" IS NOT NULL ${searchClause}
    GROUP BY a.id, a."name", a."slug"
    ORDER BY ${orderColumn} ${orderDir}
    OFFSET ${offsetParam} LIMIT ${limitParam}
  `, ...params, skip, pageSize)

  return {
    items: rows.map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      totalSize: Number(r.totalSize),
    })),
    total,
    page,
    pageSize,
    hasMore: skip + pageSize < total,
  }
}

async function queryReleasesByStatus(statuses: string[], search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = { matchStatus: { in: statuses } }
  if (search) { where.title = { contains: search, mode: 'insensitive' } }

  const sortMap: Record<string, any> = { year: { year: order }, matchStatus: { matchStatus: order } }
  const orderBy = sortMap[sort] ?? { title: order }

  const [items, total] = await Promise.all([
    prisma.localRelease.findMany({
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
    prisma.localRelease.count({ where }),
  ])

  return {
    items: items.map(r => ({
      id: r.id,
      title: r.title,
      year: r.year,
      matchStatus: r.matchStatus,
      artistName: r.artists[0]?.artist.name ?? null,
      artistSlug: r.artists[0]?.artist.slug ?? null,
    })),
    total,
    page,
    pageSize,
    hasMore: skip + pageSize < total,
  }
}

async function queryLowBitrate(search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = { bitrate: { lt: 256, gt: 0 } }
  if (search) { where.title = { contains: search, mode: 'insensitive' } }

  const sortMap: Record<string, any> = { title: { title: order }, artist: { artist: order } }
  const orderBy = sortMap[sort] ?? { bitrate: order }

  const [items, total] = await Promise.all([
    prisma.localReleaseTrack.findMany({
      where,
      select: { id: true, title: true, artist: true, bitrate: true },
      orderBy,
      skip,
      take: pageSize,
    }),
    prisma.localReleaseTrack.count({ where }),
  ])

  return {
    items: items.map(t => ({
      id: t.id,
      title: t.title,
      artistName: t.artist,
      bitrate: t.bitrate,
    })),
    total,
    page,
    pageSize,
    hasMore: skip + pageSize < total,
  }
}

async function querySingleRelease(search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const searchClause = search ? `AND a."name" ILIKE '%' || $1 || '%'` : ''
  const params = search ? [search] : []

  const orderColumnMap: Record<string, string> = { name: 'a."name"', totalSize: '"totalSize"', trackCount: '"trackCount"' }
  const orderColumn = orderColumnMap[sort] ?? '"totalSize"'
  const orderDir = order === 'asc' ? 'ASC' : 'DESC'

  const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(`
    SELECT COUNT(*)::bigint AS count FROM (
      SELECT a.id
      FROM "Artist" a
      JOIN "LocalReleaseArtist" lra ON lra."artistId" = a.id
      WHERE a."primaryArtistId" IS NULL ${searchClause}
      GROUP BY a.id
      HAVING COUNT(DISTINCT lra."localReleaseId") = 1
    ) sub
  `, ...params)

  const total = Number(countResult[0].count)
  const offsetParam = search ? '$2' : '$1'
  const limitParam = search ? '$3' : '$2'

  const rows = await prisma.$queryRawUnsafe<{ id: string; name: string; slug: string; releaseTitle: string; trackCount: bigint; totalSize: bigint }[]>(`
    SELECT a.id, a."name", a."slug",
      lr."title" AS "releaseTitle",
      COUNT(lrt.id)::bigint AS "trackCount",
      COALESCE(SUM(lrt."fileSize"), 0)::bigint AS "totalSize"
    FROM "Artist" a
    JOIN "LocalReleaseArtist" lra ON lra."artistId" = a.id
    JOIN "LocalRelease" lr ON lr.id = lra."localReleaseId"
    LEFT JOIN "LocalReleaseTrack" lrt ON lrt."localReleaseId" = lr.id
    WHERE a."primaryArtistId" IS NULL ${searchClause}
      AND a.id IN (
        SELECT lra2."artistId"
        FROM "LocalReleaseArtist" lra2
        GROUP BY lra2."artistId"
        HAVING COUNT(DISTINCT lra2."localReleaseId") = 1
      )
    GROUP BY a.id, a."name", a."slug", lr."title"
    ORDER BY ${orderColumn} ${orderDir}
    OFFSET ${offsetParam} LIMIT ${limitParam}
  `, ...params, skip, pageSize)

  return {
    items: rows.map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      releaseTitle: r.releaseTitle,
      trackCount: Number(r.trackCount),
      totalSize: Number(r.totalSize),
    })),
    total,
    page,
    pageSize,
    hasMore: skip + pageSize < total,
  }
}

async function queryShortest(search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = {}
  if (search) { where.title = { contains: search, mode: 'insensitive' } }

  const sortMap: Record<string, any> = { title: { title: order } }
  const orderBy = sortMap[sort] ?? { totalDuration: order }

  const [items, total] = await Promise.all([
    prisma.localRelease.findMany({
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
    prisma.localRelease.count({ where }),
  ])

  return {
    items: items.map(r => ({
      id: r.id,
      title: r.title,
      totalDuration: r.totalDuration,
      trackCount: r._count.tracks,
      artistName: r.artists[0]?.artist.name ?? null,
      artistSlug: r.artists[0]?.artist.slug ?? null,
    })),
    total,
    page,
    pageSize,
    hasMore: skip + pageSize < total,
  }
}

async function queryMissingArt(search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = { image: null, imageUrl: null }
  if (search) { where.title = { contains: search, mode: 'insensitive' } }

  const orderBy = sort === 'year' ? { year: order } : { title: order }

  const [items, total] = await Promise.all([
    prisma.localRelease.findMany({
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
    prisma.localRelease.count({ where }),
  ])

  return {
    items: items.map(r => ({
      id: r.id,
      title: r.title,
      year: r.year,
      artistName: r.artists[0]?.artist.name ?? null,
      artistSlug: r.artists[0]?.artist.slug ?? null,
    })),
    total,
    page,
    pageSize,
    hasMore: skip + pageSize < total,
  }
}

async function queryReleasesSynced(search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = {}
  if (search) { where.title = { contains: search, mode: 'insensitive' } }

  const orderBy = sort === 'year' ? { year: order } : { title: order }

  const [items, total] = await Promise.all([
    prisma.musicBrainzRelease.findMany({
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
    prisma.musicBrainzRelease.count({ where }),
  ])

  return {
    items: items.map(r => ({
      id: r.id,
      title: r.title,
      year: r.year,
      artistName: r.artists[0]?.artist.name ?? 'Unknown',
      artistSlug: r.artists[0]?.artist.slug ?? '',
    })),
    total,
    page,
    pageSize,
    hasMore: skip + pageSize < total,
  }
}

// Release Types (pages/statistics/types.vue): one row per artist, one column per bucket - a single
// pivoted table instead of a tab per bucket, since the whole vocabulary is only 8 buckets. Connected
// (duplicate) artists roll up onto their primary, same convention as queryArtists's "Linked artists"
// note above. releaseTypeBuckets (helpers/constants.ts) drives the column list so a new bucket only
// needs adding there and to releaseTypeBucketSql's CASE.
const RELEASE_TYPE_BUCKET_IDS = releaseTypeBuckets.map(b => b.id)

async function queryReleaseTypesPivot(search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const searchClause = search ? `AND a2."name" ILIKE '%' || $1 || '%'` : ''
  const params = search ? [search] : []

  const bucketColumns = RELEASE_TYPE_BUCKET_IDS
    .map(id => `COUNT(*) FILTER (WHERE rb.bucket = '${id}')::int AS "${id}"`)
    .join(',\n      ')

  const orderColumnMap: Record<string, string> = { name: 'a2."name"' }
  for (const id of RELEASE_TYPE_BUCKET_IDS) { orderColumnMap[id] = `"${id}"` }
  const orderColumn = orderColumnMap[sort] ?? 'a2."name"'
  const orderDir = order === 'asc' ? 'ASC' : 'DESC'

  const releaseBucketsCte = `
    WITH release_buckets AS (
      SELECT lra."artistId", ${releaseTypeBucketSql} AS bucket
      FROM "LocalRelease" lr
      JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
      LEFT JOIN "MusicBrainzRelease" mb ON mb.id = lr."releaseId"
      LEFT JOIN "ReleaseType" rt ON rt.id = mb."typeId"
    )
  `

  const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(`
    ${releaseBucketsCte}
    SELECT COUNT(*)::bigint AS count FROM (
      SELECT a2.id
      FROM release_buckets rb
      JOIN "Artist" a ON a.id = rb."artistId"
      JOIN "Artist" a2 ON a2.id = COALESCE(a."primaryArtistId", a.id)
      WHERE 1 = 1 ${searchClause}
      GROUP BY a2.id
    ) sub
  `, ...params)

  const total = Number(countResult[0].count)
  const offsetParam = search ? '$2' : '$1'
  const limitParam = search ? '$3' : '$2'

  const rows = await prisma.$queryRawUnsafe<Record<string, any>[]>(`
    ${releaseBucketsCte}
    SELECT a2.id, a2."name", a2."slug",
      ${bucketColumns}
    FROM release_buckets rb
    JOIN "Artist" a ON a.id = rb."artistId"
    JOIN "Artist" a2 ON a2.id = COALESCE(a."primaryArtistId", a.id)
    WHERE 1 = 1 ${searchClause}
    GROUP BY a2.id, a2."name", a2."slug"
    ORDER BY ${orderColumn} ${orderDir}
    OFFSET ${offsetParam} LIMIT ${limitParam}
  `, ...params, skip, pageSize)

  return {
    items: rows.map(r => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      ...Object.fromEntries(RELEASE_TYPE_BUCKET_IDS.map(id => [id, r[id]])),
    })),
    total,
    page,
    pageSize,
    hasMore: skip + pageSize < total,
  }
}

// Release Types drill-down (pages/statistics/types/[bucket].vue): one artist's releases within one
// bucket - "Britney Spears' Singles" - reached by clicking a nonzero cell in the pivoted table above.
// Matches both the given artist and any artist rolled onto it via primaryArtistId (a TypesPage.vue
// row is already the *primary* artist, so its duplicates' own releases belong on this list too).
async function queryReleaseTypeDetail(bucket: string, artistSlug: string, search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const artist = await prisma.artist.findUnique({ where: { slug: artistSlug }, select: { id: true } })
  if (!artist) {
    throw createError({ statusCode: 404, statusMessage: 'Artist not found' })
  }

  const searchClause = search ? `AND lr."title" ILIKE '%' || $3 || '%'` : ''
  const params = search ? [bucket, artist.id, search] : [bucket, artist.id]

  const orderColumnMap: Record<string, string> = { title: 'lr."title"', year: 'lr."year"', updatedAt: 'lr."updatedAt"' }
  const orderColumn = orderColumnMap[sort] ?? 'lr."year"'
  const orderDir = order === 'asc' ? 'ASC' : 'DESC'

  const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(`
    SELECT COUNT(DISTINCT lr.id)::bigint AS count
    FROM "LocalRelease" lr
    JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
    JOIN "Artist" a ON a.id = lra."artistId"
    LEFT JOIN "MusicBrainzRelease" mb ON mb.id = lr."releaseId"
    LEFT JOIN "ReleaseType" rt ON rt.id = mb."typeId"
    WHERE (${releaseTypeBucketSql}) = $1 AND (a.id = $2 OR a."primaryArtistId" = $2) ${searchClause}
  `, ...params)

  const total = Number(countResult[0].count)
  const offsetParam = search ? '$4' : '$3'
  const limitParam = search ? '$5' : '$4'

  const rows = await prisma.$queryRawUnsafe<{ id: string, title: string, year: number | null, updatedAt: Date | string | null }[]>(`
    SELECT DISTINCT lr.id, lr."title", lr."year", lr."updatedAt"
    FROM "LocalRelease" lr
    JOIN "LocalReleaseArtist" lra ON lra."localReleaseId" = lr.id
    JOIN "Artist" a ON a.id = lra."artistId"
    LEFT JOIN "MusicBrainzRelease" mb ON mb.id = lr."releaseId"
    LEFT JOIN "ReleaseType" rt ON rt.id = mb."typeId"
    WHERE (${releaseTypeBucketSql}) = $1 AND (a.id = $2 OR a."primaryArtistId" = $2) ${searchClause}
    ORDER BY ${orderColumn} ${orderDir}
    OFFSET ${offsetParam} LIMIT ${limitParam}
  `, ...params, skip, pageSize)

  return {
    items: rows.map(r => ({ id: r.id, title: r.title, year: r.year, updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null })),
    total,
    page,
    pageSize,
    hasMore: skip + pageSize < total,
  }
}
