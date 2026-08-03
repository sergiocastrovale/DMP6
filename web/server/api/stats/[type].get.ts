import { prisma } from '~/server/utils/prisma'
import { parsePagination } from '~/server/utils/pagination'

const VALID_TYPES = new Set([
  'artists', 'releases', 'tracks', 'genres', 'plays', 'size',
  'artists-synced', 'releases-synced',
  'artists-with-art', 'releases-with-art',
  'unmatched', 'incomplete', 'bitrate', 'single-release', 'shortest', 'missing-art',
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
      return queryPlays(search, skip, pageSize, page, sort, order)
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

async function queryPlays(search: string, skip: number, pageSize: number, page: number, sort: string, order: 'asc' | 'desc') {
  const where: any = { playCount: { gt: 0 } }
  if (search) { where.title = { contains: search, mode: 'insensitive' } }

  const sortMap: Record<string, any> = {
    title: { title: order },
    artist: { artist: order },
  }
  const orderBy = sortMap[sort] ?? { playCount: order }

  const [items, total] = await Promise.all([
    prisma.localReleaseTrack.findMany({
      where,
      select: { id: true, title: true, artist: true, playCount: true },
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
      playCount: t.playCount,
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
