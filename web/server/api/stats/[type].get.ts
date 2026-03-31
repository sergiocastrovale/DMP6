import { prisma } from '~/server/utils/prisma'

const VALID_TYPES = new Set([
  'artists', 'releases', 'tracks', 'genres', 'plays',
  'artists-synced', 'releases-synced',
  'artists-with-art', 'releases-with-art',
])

export default defineEventHandler(async (event) => {
  const type = getRouterParam(event, 'type')
  if (!type || !VALID_TYPES.has(type))
    throw createError({ statusCode: 400, statusMessage: 'Invalid stat type' })

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 200))
  const search = (query.search as string)?.trim() || ''
  const skip = (page - 1) * pageSize

  switch (type) {
    case 'artists':
    case 'artists-synced':
    case 'artists-with-art':
      return queryArtists(type, search, skip, pageSize, page)
    case 'releases':
    case 'releases-with-art':
      return queryReleases(type, search, skip, pageSize, page)
    case 'tracks':
      return queryTracks(search, skip, pageSize, page)
    case 'genres':
      return queryGenres(search, skip, pageSize, page)
    case 'plays':
      return queryPlays(search, skip, pageSize, page)
    case 'releases-synced':
      return queryReleasesSynced(search, skip, pageSize, page)
    default:
      throw createError({ statusCode: 400, statusMessage: 'Invalid stat type' })
  }
})

async function queryArtists(type: string, search: string, skip: number, pageSize: number, page: number) {
  const where: any = {}
  if (search) where.name = { contains: search, mode: 'insensitive' }
  if (type === 'artists-synced') where.musicbrainzId = { not: null }
  if (type === 'artists-with-art') where.OR = [{ image: { not: null } }, { imageUrl: { not: null } }]

  const [items, total] = await Promise.all([
    prisma.artist.findMany({
      where,
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
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

async function queryReleases(type: string, search: string, skip: number, pageSize: number, page: number) {
  const where: any = {}
  if (search) where.title = { contains: search, mode: 'insensitive' }
  if (type === 'releases-with-art') where.OR = [{ image: { not: null } }, { imageUrl: { not: null } }]

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
      orderBy: { title: 'asc' },
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

async function queryTracks(search: string, skip: number, pageSize: number, page: number) {
  const where: any = {}
  if (search) where.title = { contains: search, mode: 'insensitive' }

  const [items, total] = await Promise.all([
    prisma.localReleaseTrack.findMany({
      where,
      select: { id: true, title: true, artist: true },
      orderBy: { title: 'asc' },
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

async function queryGenres(search: string, skip: number, pageSize: number, page: number) {
  const where: any = {}
  if (search) where.name = { contains: search, mode: 'insensitive' }

  const [items, total] = await Promise.all([
    prisma.genre.findMany({
      where,
      select: {
        id: true,
        name: true,
        _count: { select: { artists: true } },
      },
      orderBy: { name: 'asc' },
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

async function queryPlays(search: string, skip: number, pageSize: number, page: number) {
  const where: any = { playCount: { gt: 0 } }
  if (search) where.title = { contains: search, mode: 'insensitive' }

  const [items, total] = await Promise.all([
    prisma.localReleaseTrack.findMany({
      where,
      select: { id: true, title: true, artist: true, playCount: true },
      orderBy: { playCount: 'desc' },
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

async function queryReleasesSynced(search: string, skip: number, pageSize: number, page: number) {
  const where: any = {}
  if (search) where.title = { contains: search, mode: 'insensitive' }

  const [items, total] = await Promise.all([
    prisma.musicBrainzRelease.findMany({
      where,
      select: {
        id: true,
        title: true,
        year: true,
        artist: { select: { name: true, slug: true } },
      },
      orderBy: { title: 'asc' },
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
      artistName: r.artist.name,
      artistSlug: r.artist.slug,
    })),
    total,
    page,
    pageSize,
    hasMore: skip + pageSize < total,
  }
}
