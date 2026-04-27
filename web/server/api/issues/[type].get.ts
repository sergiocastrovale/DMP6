import { prisma } from '~/server/utils/prisma'
import { parsePagination } from '~/server/utils/pagination'
import type { PaginatedResponse } from '~/types/api'

const VALID_TYPES = ['corrupted', 'unsplit', 'orphans', 'duplicates', 'missing', 'enrichment'] as const
type IssueType = typeof VALID_TYPES[number]

export default defineEventHandler(async (event) => {
  const type = getRouterParam(event, 'type') as IssueType
  if (!VALID_TYPES.includes(type)) {
    throw createError({ statusCode: 404, message: `Unknown issue type: ${type}` })
  }

  const rawQuery = getQuery(event)
  const { sort, order = 'asc', q } = rawQuery
  const { page: p, pageSize: ps, skip } = parsePagination(rawQuery, { defaultSize: 50, maxSize: 100 })

  const orderDir = order === 'desc' ? 'desc' : 'asc'

  const [items, total] = await fetchType(type, skip, ps, sort as string, orderDir, q as string)

  return {
    items,
    total,
    page: p,
    pageSize: ps,
    hasMore: skip + ps < total,
  } satisfies PaginatedResponse<unknown>
})

async function fetchType(
  type: IssueType,
  skip: number,
  take: number,
  sort: string | undefined,
  order: 'asc' | 'desc',
  q: string | undefined,
): Promise<[unknown[], number]> {
  switch (type) {
    case 'corrupted': {
      const where = q
        ? { OR: [{ currentValue: { contains: q, mode: 'insensitive' as const } }, { proposedValue: { contains: q, mode: 'insensitive' as const } }], status: 'DETECTED' as const }
        : { status: 'DETECTED' as const }
      const orderBy = sort === 'confidence' ? { confidence: order } : sort === 'currentValue' ? { currentValue: order } : { createdAt: order }
      const [raw, total] = await Promise.all([
        prisma.issueCorruptedTpe2.findMany({
          where,
          skip,
          take,
          orderBy,
          include: {
            track: {
              select: {
                id: true,
                filePath: true,
                title: true,
                album: true,
                localReleaseId: true,
                localRelease: { select: { artists: { include: { artist: { select: { name: true, slug: true } } } } } },
              },
            },
          },
        }),
        prisma.issueCorruptedTpe2.count({ where }),
      ])
      // Flatten nested artist to top-level for simpler template access
      const items = raw.map(item => ({
        ...item,
        artist: item.track?.localRelease?.artists?.[0]?.artist ?? null,
      }))
      return [items, total]
    }

    case 'unsplit': {
      const where = q
        ? { artist: { name: { contains: q, mode: 'insensitive' as const } }, status: 'DETECTED' as const }
        : { status: 'DETECTED' as const }
      const orderBy = sort === 'separator' ? { separator: order } : { createdAt: order }
      const [items, total] = await Promise.all([
        prisma.issueUnsplitArtist.findMany({
          where,
          skip,
          take,
          orderBy,
          include: { artist: { select: { id: true, name: true, slug: true, totalTracks: true } } },
        }),
        prisma.issueUnsplitArtist.count({ where }),
      ])
      return [items, total]
    }

    case 'orphans': {
      const where = q
        ? { artist: { name: { contains: q, mode: 'insensitive' as const } }, status: 'DETECTED' as const }
        : { status: 'DETECTED' as const }
      const orderBy = sort === 'reason' ? { reason: order } : sort === 'name' ? { artist: { name: order } } : { createdAt: order }
      const [items, total] = await Promise.all([
        prisma.issueOrphanArtist.findMany({
          where,
          skip,
          take,
          orderBy,
          include: { artist: { select: { id: true, name: true, slug: true, createdAt: true, musicbrainzId: true } } },
        }),
        prisma.issueOrphanArtist.count({ where }),
      ])
      return [items, total]
    }

    case 'duplicates': {
      const where = q
        ? { OR: [{ artistA: { name: { contains: q, mode: 'insensitive' as const } } }, { artistB: { name: { contains: q, mode: 'insensitive' as const } } }], status: 'DETECTED' as const }
        : { status: 'DETECTED' as const }
      const [items, total] = await Promise.all([
        prisma.issueDuplicateArtist.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: order },
          include: {
            artistA: { select: { id: true, name: true, slug: true, totalTracks: true } },
            artistB: { select: { id: true, name: true, slug: true, totalTracks: true } },
          },
        }),
        prisma.issueDuplicateArtist.count({ where }),
      ])
      return [items, total]
    }

    case 'missing': {
      const where = q
        ? { track: { OR: [{ title: { contains: q, mode: 'insensitive' as const } }, { album: { contains: q, mode: 'insensitive' as const } }] }, status: 'DETECTED' as const }
        : { status: 'DETECTED' as const }
      const [items, total] = await Promise.all([
        prisma.issueMissingMetadata.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: order },
          include: {
            track: { select: { id: true, filePath: true, title: true, album: true, artist: true } },
          },
        }),
        prisma.issueMissingMetadata.count({ where }),
      ])
      return [items, total]
    }

    case 'enrichment': {
      const where = q
        ? { localRelease: { title: { contains: q, mode: 'insensitive' as const } }, status: 'DETECTED' as const }
        : { status: 'DETECTED' as const }
      const orderBy = sort === 'title'
        ? { localRelease: { title: order } }
        : sort === 'year' ? { localRelease: { year: order } }
        : { createdAt: order }
      const [items, total] = await Promise.all([
        prisma.issueEnrichmentGap.findMany({
          where,
          skip,
          take,
          orderBy,
          include: {
            localRelease: {
              select: {
                id: true,
                title: true,
                year: true,
                artists: { include: { artist: { select: { name: true, slug: true } } } },
              },
            },
          },
        }),
        prisma.issueEnrichmentGap.count({ where }),
      ])
      // Flatten primary artist to top-level
      const mapped = items.map(item => ({
        ...item,
        artist: item.localRelease?.artists?.[0]?.artist ?? null,
      }))
      return [mapped, total]
    }
  }
}
