import { prisma } from '~/server/utils/prisma'
import { cachedResponse } from '~/server/utils/cache'
import { parsePagination } from '~/server/utils/pagination'
import { hasPermission } from '~/server/utils/permissions'
import { currentUserId } from '~/server/utils/libraryOwnership'
import { releasePlayTotals } from '~/server/utils/userPlays'
import { favoriteReleaseTargetIds } from '~/server/utils/favorites'
import { favoriteTargetId } from '~/helpers/artistPageLogic'
import { applyPlays, buildArtistCatalogue, pageCatalogue, playReleaseIds } from '~/server/utils/artistCatalogue'

export default defineEventHandler(async (event) => {
  const userId = currentUserId(event)
  const slug = getRouterParam(event, 'slug')
  if (!slug) {throw createError({ statusCode: 400, statusMessage: 'Missing slug' })}

  const query = getQuery(event)
  const { page, pageSize } = parsePagination(query, { defaultSize: 20, maxSize: 500 })
  const all = query.all === '1' || query.all === 'true'

  // The catalogue is user-independent and expensive to assemble, so it is cached (10 min, library-versioned -
  // a rescan or merge invalidates it). Everything that differs per user - plays, download state - is attached
  // after the cache. A 404 for an unknown slug is thrown inside the builder and therefore never cached.
  const catalogue = await cachedResponse(`artist-releases:${slug}`, 600, () => buildArtistCatalogue(slug), { shared: true })

  const localIds = catalogue.flatMap(playReleaseIds)
  const [plays, favoriteTargets] = await Promise.all([
    releasePlayTotals(userId, localIds),
    favoriteReleaseTargetIds(userId),
  ])
  const releases = applyPlays(catalogue, plays)
  // Which of this page's favorite targets the user has starred - the artist page seeds its hearts from this
  // rather than fetching /api/favorites (which returns one page of favorites, not "is this one starred").
  const favoriteReleaseIds = [...new Set(releases.map(favoriteTargetId).filter((id): id is string => !!id && favoriteTargets.has(id)))]

  const result = pageCatalogue(releases, { page, pageSize, all })
  const paged = result.releases

  // Attach in-flight download state (acquisition pipeline) for the paged cards.
  // PROMOTED/REJECTED are excluded on purpose: promoted shows as a real local release,
  // rejected reverts to plain MISSING. Only for users who can see downloads at all.
  const pagedMbIds = paged.map(r => r.mbReleaseRowId).filter((v): v is string => !!v)
  const user = event.context.user
  if (pagedMbIds.length > 0 && user && await hasPermission(user.role, 'sync.view')) {
    const dls = await prisma.downloadedRelease.findMany({
      where: {
        mbReleaseId: { in: pagedMbIds },
        status: { in: ['SEARCHING', 'DOWNLOADING', 'ENRICHING', 'READY', 'FAILED', 'ABANDONED'] },
      },
      select: { id: true, mbReleaseId: true, status: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    })
    const dlByMb = new Map<string, { id: string; status: string }>()
    for (const d of dls) {
      if (d.mbReleaseId && !dlByMb.has(d.mbReleaseId)) {dlByMb.set(d.mbReleaseId, { id: d.id, status: d.status })}
    }
    for (const r of paged) {
      const d = r.mbReleaseRowId ? dlByMb.get(r.mbReleaseRowId) : undefined
      if (d) {
        r.downloadState = d.status
        r.downloadedReleaseId = d.id
      }
    }
  }

  return { ...result, favoriteReleaseIds }
})
