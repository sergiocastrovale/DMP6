import { prisma } from '~/server/utils/prisma'
import { parsePagination } from '~/server/utils/pagination'
import { requirePermission } from '~/server/utils/permissions'
import type { PaginatedResponse } from '~/types/api'

const VALID_TYPES = ['corrupted', 'unsplit', 'orphans', 'duplicates', 'missing', 'enrichment'] as const
type IssueType = typeof VALID_TYPES[number]

const VALID_STATUSES = ['DETECTED', 'PENDING', 'PENDING_REVERT', 'RESOLVED', 'FAILED'] as const

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'issues.view')

  const type = getRouterParam(event, 'type') as IssueType
  if (!VALID_TYPES.includes(type)) {
    throw createError({ statusCode: 404, message: `Unknown issue type: ${type}` })
  }

  const rawQuery = getQuery(event)
  const { sort, order = 'asc', q } = rawQuery
  const statusParam = (rawQuery.status as string) || 'DETECTED'
  const status = VALID_STATUSES.includes(statusParam as any) ? statusParam : 'DETECTED'
  const { page: p, pageSize: ps, skip } = parsePagination(rawQuery, { defaultSize: 50, maxSize: 100 })

  const orderDir = order === 'desc' ? 'desc' : 'asc'

  const [items, total] = await fetchType(type, skip, ps, sort as string, orderDir, q as string, status)

  if (status === 'RESOLVED' && ['corrupted', 'unsplit', 'missing'].includes(type)) {
    const issueIds = (items as any[]).map((i: any) => i.id)
    if (issueIds.length > 0) {
      const history = await prisma.fixHistory.findMany({
        where: { issueId: { in: issueIds }, revertedAt: null },
        orderBy: { appliedAt: 'desc' },
      })
      const historyByIssue = new Map<string, typeof history>()
      for (const h of history) {
        const arr = historyByIssue.get(h.issueId) || []
        arr.push(h)
        historyByIssue.set(h.issueId, arr)
      }
      for (const item of items as any[]) {
        item.fixHistory = historyByIssue.get(item.id) || []
      }
    }
  }

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
  status: string,
): Promise<[unknown[], number]> {
  switch (type) {
    case 'corrupted': {
      const where = q
        ? { OR: [{ currentValue: { contains: q, mode: 'insensitive' as const } }, { proposedValue: { contains: q, mode: 'insensitive' as const } }], status: status as any }
        : { status: status as any }
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
      const items = raw.map(item => ({
        ...item,
        artist: item.track?.localRelease?.artists?.[0]?.artist ?? null,
      }))
      return [items, total]
    }

    case 'unsplit': {
      const where = q
        ? { artist: { name: { contains: q, mode: 'insensitive' as const } }, status: status as any }
        : { status: status as any }
      const orderBy = sort === 'separator' ? { separator: order } : { createdAt: order }
      const [raw, total] = await Promise.all([
        prisma.issueUnsplitArtist.findMany({
          where,
          skip,
          take,
          orderBy,
          include: {
            artist: {
              select: {
                id: true, name: true, slug: true, totalTracks: true,
                localReleases: { take: 1, select: { localRelease: { select: { tracks: { take: 1, select: { filePath: true } } } } } },
              },
            },
          },
        }),
        prisma.issueUnsplitArtist.count({ where }),
      ])
      const items = raw.map(item => ({
        ...item,
        folderPath: item.artist?.localReleases?.[0]?.localRelease?.tracks?.[0]?.filePath ?? null,
      }))
      return [items, total]
    }

    case 'orphans': {
      const where = q
        ? { artist: { name: { contains: q, mode: 'insensitive' as const } }, status: status as any }
        : { status: status as any }
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
        ? { OR: [{ artistA: { name: { contains: q, mode: 'insensitive' as const } } }, { artistB: { name: { contains: q, mode: 'insensitive' as const } } }], status: status as any }
        : { status: status as any }
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
        ? { track: { OR: [{ title: { contains: q, mode: 'insensitive' as const } }, { album: { contains: q, mode: 'insensitive' as const } }] }, status: status as any }
        : { status: status as any }
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
        ? { localRelease: { title: { contains: q, mode: 'insensitive' as const } }, status: status as any }
        : { status: status as any }
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
                tracks: { take: 1, select: { filePath: true } },
              },
            },
          },
        }),
        prisma.issueEnrichmentGap.count({ where }),
      ])
      const mapped = items.map(item => ({
        ...item,
        artist: item.localRelease?.artists?.[0]?.artist ?? null,
        folderPath: item.localRelease?.tracks?.[0]?.filePath ?? null,
      }))
      return [mapped, total]
    }
  }
}
