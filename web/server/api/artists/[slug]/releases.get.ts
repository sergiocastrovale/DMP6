import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import { parsePagination } from '~/server/utils/pagination'
import { hasPermission } from '~/server/utils/permissions'
import {
  accumulateAlsoPartOf,
  buildAppearsOnCards,
  buildCoArtistMap,
  buildConnectedArtistByRelease,
  buildLocalAndGapCards,
  sortReleaseCards,
} from '~/server/utils/releaseAggregation'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) {throw createError({ statusCode: 400, statusMessage: 'Missing slug' })}

  const query = getQuery(event)
  const { page, pageSize } = parsePagination(query, { defaultSize: 20, maxSize: 500 })

  const artist = await prisma.artist.findUnique({
    where: { slug },
    select: { id: true },
  })

  if (!artist) {throw createError({ statusCode: 404, statusMessage: 'Artist not found' })}

  const connectedArtists = await prisma.artist.findMany({
    where: { primaryArtistId: artist.id },
    select: { id: true, name: true, slug: true },
  })
  const allArtistIds = [artist.id, ...connectedArtists.map(a => a.id)]
  const connectedArtistById = new Map(connectedArtists.map(a => [a.id, a]))

  const mbReleaseLinks = await prisma.musicBrainzReleaseArtist.findMany({
    where: { artistId: { in: allArtistIds } },
    select: {
      release: {
        select: {
          id: true,
          title: true,
          year: true,
          musicbrainzId: true,
          releaseGroupId: true,
          disambiguation: true,
          editionLabel: true,
          releaseDate: true,
          packaging: true,
          country: true,
          format: true,
          status: true,
          statusReason: true,
          mediumCount: true,
          media: {
            select: { position: true, title: true, equivalentReleaseId: true, equivalentReleaseGroupId: true },
            orderBy: { position: 'asc' },
          },
          type: { select: { name: true, slug: true } },
          tracks: { select: { id: true } },
        },
      },
    },
  })
  const mbReleases = mbReleaseLinks.map(l => l.release)
  const mbById = new Map(mbReleases.map(r => [r.id, r]))

  // Get all local releases for this artist (via LocalReleaseArtist junction)
  const releaseLinks = await prisma.localReleaseArtist.findMany({
    where: { artistId: { in: allArtistIds } },
    select: { localReleaseId: true, artistId: true },
  })
  const releaseIds = [...new Set(releaseLinks.map(l => l.localReleaseId))]
  const connectedArtistByRelease = buildConnectedArtistByRelease(releaseLinks, connectedArtistById)

  const localReleases = await prisma.localRelease.findMany({
    where: { id: { in: releaseIds } },
    select: {
      id: true,
      title: true,
      year: true,
      folderPath: true,
      image: true,
      imageUrl: true,
      matchStatus: true,
      releaseId: true,
      totalPlayCount: true,
      tracks: { select: { id: true } },
      artists: {
        select: {
          artist: { select: { name: true, slug: true } },
        },
      },
      mediumPosition: true,
      boxReleaseId: true,
      boxMediumPosition: true,
    },
    orderBy: [{ year: 'asc' }, { title: 'asc' }],
  })

  // Build co-artist map: for each local release, list other artists (excluding current + connected)
  const connectedSlugs = new Set(connectedArtists.map(a => a.slug))
  const coArtistMap = buildCoArtistMap(localReleases, slug, connectedSlugs)

  // docs/sync_decisions.md: box sets in the catalogue that reprint any of this page's release groups -
  // a pure catalogue fact, independent of ownership. Batched once across every group id on the page.
  const releaseGroupIds = [...new Set(mbReleases.map(r => r.releaseGroupId).filter((id): id is string => !!id))]
  const alsoPartOfMedia = releaseGroupIds.length > 0
    ? await prisma.musicBrainzReleaseMedium.findMany({
      where: { equivalentReleaseGroupId: { in: releaseGroupIds } },
      select: { equivalentReleaseGroupId: true, releaseId: true, release: { select: { title: true, year: true } } },
    })
    : []
  const alsoPartOfByGroupId = new Map<string, { title: string, year: number | null }[]>()
  const alsoPartOfSeen = new Map<string, Set<string>>()
  accumulateAlsoPartOf(alsoPartOfMedia, alsoPartOfByGroupId, alsoPartOfSeen)

  const { cards: localAndGapCards, appearsOnLocal } = buildLocalAndGapCards({
    localReleases,
    mbById,
    coArtistMap,
    connectedArtistByRelease,
    resolveImage: verifyImage,
    alsoPartOfByGroupId,
  })

  // Appears-On: LocalReleases whose MB release is NOT in this artist's catalogue.
  // Fetch those MB rows so the cards get real type/year/status/trackCount.
  const appearsOnMbIds = appearsOnLocal.map(lr => lr.releaseId!)
  const appearsOnMbReleases = appearsOnMbIds.length > 0
    ? await prisma.musicBrainzRelease.findMany({
      where: { id: { in: appearsOnMbIds } },
      select: {
        id: true,
        title: true,
        musicbrainzId: true,
        releaseGroupId: true,
        disambiguation: true,
        editionLabel: true,
        releaseDate: true,
        packaging: true,
        country: true,
        format: true,
        year: true,
        status: true,
        statusReason: true,
        mediumCount: true,
        media: {
          select: { position: true, title: true, equivalentReleaseId: true, equivalentReleaseGroupId: true },
          orderBy: { position: 'asc' },
        },
        type: { select: { name: true, slug: true } },
        tracks: { select: { id: true } },
      },
    })
    : []
  const appearsOnMbById = new Map(appearsOnMbReleases.map(r => [r.id, r]))

  const appearsOnGroupIds = [...new Set(appearsOnMbReleases.map(r => r.releaseGroupId).filter((id): id is string => !!id))]
    .filter(id => !alsoPartOfByGroupId.has(id))
  if (appearsOnGroupIds.length > 0) {
    const extraMedia = await prisma.musicBrainzReleaseMedium.findMany({
      where: { equivalentReleaseGroupId: { in: appearsOnGroupIds } },
      select: { equivalentReleaseGroupId: true, releaseId: true, release: { select: { title: true, year: true } } },
    })
    accumulateAlsoPartOf(extraMedia, alsoPartOfByGroupId, alsoPartOfSeen)
  }

  const appearsOnCards = buildAppearsOnCards({
    appearsOnLocal,
    appearsOnMbById,
    coArtistMap,
    connectedArtistByRelease,
    resolveImage: verifyImage,
    alsoPartOfByGroupId,
  })

  const releases = sortReleaseCards([...localAndGapCards, ...appearsOnCards])

  // Paginate the unified list
  const total = releases.length
  const start = (page - 1) * pageSize
  const paged = releases.slice(start, start + pageSize)

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

  return {
    releases: paged,
    total,
    page,
    pageSize,
    hasMore: start + pageSize < total,
  }
})
