import { prisma } from '~/server/utils/prisma'
import { paged, parsePagination } from '~/server/utils/pagination'
import { requirePermission } from '~/server/utils/permissions'
import { firstArtist } from '~/server/utils/releaseTiles'
import { requireIssueType, type IssueStatus } from '~/server/utils/issueTypes'
import type { PaginatedResponse } from '~/types/api'
import type { IssueType } from '~/types/issues'

const VALID_STATUSES: readonly IssueStatus[] = ['DETECTED', 'PENDING', 'PENDING_REVERT', 'RESOLVED', 'FAILED']

// The duplicate-release and mismatched-release-id tables share this shape but not a Prisma type.
interface ReleasePairSide {
  _count?: { tracks: number }
  artists?: { artist: { name: string, slug: string } }[]
  [key: string]: unknown
}
interface ReleasePairRow { releaseA: ReleasePairSide | null, releaseB: ReleasePairSide | null, [key: string]: unknown }
interface ReleasePairModel {
  findMany: (args: unknown) => Promise<ReleasePairRow[]>
  count: (args: unknown) => Promise<number>
}

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'issues.view')

  const type = getRouterParam(event, 'type') as IssueType
  requireIssueType(type)

  const rawQuery = getQuery(event)
  const { sort, order = 'asc', q } = rawQuery
  const statusParam = (rawQuery.status as string) || 'DETECTED'
  const status: IssueStatus = VALID_STATUSES.find(s => s === statusParam) ?? 'DETECTED'
  const { page: p, pageSize: ps, skip } = parsePagination(rawQuery, { defaultSize: 50, maxSize: 100 })

  const orderDir = order === 'desc' ? 'desc' : 'asc'

  const [items, total] = await fetchType(type, skip, ps, sort as string, orderDir, q as string, status)

  if (status === 'RESOLVED' && ['corrupted', 'missing'].includes(type)) {
    const rows = items as { id: string, fixHistory?: unknown }[]
    const issueIds = rows.map(i => i.id)
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
      for (const item of rows) {
        item.fixHistory = historyByIssue.get(item.id) || []
      }
    }
  }

  return paged(items as unknown[], total, { page: p, pageSize: ps, skip }) satisfies PaginatedResponse<unknown>
})

const fetchType = async (
  type: IssueType,
  skip: number,
  take: number,
  sort: string | undefined,
  order: 'asc' | 'desc',
  q: string | undefined,
  status: IssueStatus,
): Promise<[unknown[], number]> => {
  switch (type) {
    case 'corrupted': {
      const where = q
        ? { OR: [{ currentValue: { contains: q, mode: 'insensitive' as const } }, { proposedValue: { contains: q, mode: 'insensitive' as const } }], status }
        : { status }
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
        artist: item.track?.localRelease ? firstArtist(item.track.localRelease) : null,
      }))
      return [items, total]
    }

    case 'orphans': {
      const where = q
        ? { artist: { name: { contains: q, mode: 'insensitive' as const } }, status }
        : { status }
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
        ? { OR: [{ artistA: { name: { contains: q, mode: 'insensitive' as const } } }, { artistB: { name: { contains: q, mode: 'insensitive' as const } } }], status }
        : { status }
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
        ? { track: { OR: [{ title: { contains: q, mode: 'insensitive' as const } }, { album: { contains: q, mode: 'insensitive' as const } }] }, status }
        : { status }
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
        ? { localRelease: { title: { contains: q, mode: 'insensitive' as const } }, status }
        : { status }
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
                folderPath: true,
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
        artist: item.localRelease ? firstArtist(item.localRelease) : null,
        folderPath: item.localRelease?.tracks?.[0]?.filePath ?? null,
      }))
      return [mapped, total]
    }

    case 'duplicate-release':
    case 'mismatched-release-id': {
      const model = type === 'duplicate-release' ? prisma.issueDuplicateRelease : prisma.issueMismatchedReleaseId
      const where = q
        ? { OR: [{ releaseA: { title: { contains: q, mode: 'insensitive' as const } } }, { releaseB: { title: { contains: q, mode: 'insensitive' as const } } }], status }
        : { status }
      const releaseSelect = {
        id: true,
        title: true,
        year: true,
        totalDuration: true,
        folderPath: true,
        artists: { take: 1, include: { artist: { select: { name: true, slug: true } } } },
        _count: { select: { tracks: true } },
        release: type === 'mismatched-release-id' ? { select: { title: true } } : false,
      } as const
      const pairModel = model as unknown as ReleasePairModel
      const [raw, total] = await Promise.all([
        pairModel.findMany({
          where,
          skip,
          take,
          orderBy: { createdAt: order },
          include: { releaseA: { select: releaseSelect }, releaseB: { select: releaseSelect } },
        }),
        pairModel.count({ where }),
      ])
      const flattenRelease = (r: ReleasePairSide | null) => r && {
        ...r,
        trackCount: r._count?.tracks ?? 0,
        artist: r.artists ? firstArtist({ artists: r.artists }) : null,
      }
      const items = raw.map(item => ({
        ...item,
        releaseA: flattenRelease(item.releaseA),
        releaseB: flattenRelease(item.releaseB),
      }))
      return [items, total]
    }
  }
}
