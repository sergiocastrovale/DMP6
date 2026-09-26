import type { AlsoPartOfEntry, UnifiedRelease } from '~/types/release'
import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import {
  accumulateAlsoPartOf,
  buildAppearsOnCards,
  buildCoArtistMap,
  buildConnectedArtistByRelease,
  buildLocalAndGapCards,
  LOCAL_RELEASE_CARD_SELECT,
  MB_RELEASE_CARD_SELECT,
  sortReleaseCards,
} from '~/server/utils/releaseAggregation'

// An artist's whole unified catalogue: releases they own, MusicBrainz gaps, and "appears on" credits.
//
// The result carries NOTHING user-specific - `totalPlayCount` is left at 0 and applyPlays() fills it in per
// request - so it can sit in the shared Redis cache for every user. A prolific artist (Bach: ~5,800 MusicBrainz
// releases) is expensive to assemble, and it used to be rebuilt in full, then sliced to one page, on every call.
//
// Rounds of independent queries run in parallel; only the appears-on lookup genuinely depends on an earlier
// result (it needs the release ids buildLocalAndGapCards discovers).
export const buildArtistCatalogue = async (slug: string): Promise<UnifiedRelease[]> => {
  const artist = await prisma.artist.findUnique({
    where: { slug },
    select: { id: true, connectedArtists: { select: { id: true, name: true, slug: true } } },
  })
  if (!artist) {
    throw createError({ statusCode: 404, statusMessage: 'Artist not found' })
  }

  const connectedArtists = artist.connectedArtists
  const allArtistIds = [artist.id, ...connectedArtists.map(a => a.id)]
  const connectedArtistById = new Map(connectedArtists.map(a => [a.id, a]))

  const [mbReleaseLinks, releaseLinks, localReleases] = await Promise.all([
    prisma.musicBrainzReleaseArtist.findMany({
      where: { artistId: { in: allArtistIds } },
      select: { release: { select: MB_RELEASE_CARD_SELECT } },
    }),
    prisma.localReleaseArtist.findMany({
      where: { artistId: { in: allArtistIds } },
      select: { localReleaseId: true, artistId: true },
    }),
    prisma.localRelease.findMany({
      where: { artists: { some: { artistId: { in: allArtistIds } } } },
      select: LOCAL_RELEASE_CARD_SELECT,
      orderBy: [{ year: 'asc' }, { title: 'asc' }],
    }),
  ])

  // Deduplicated by id: one MB release credits several of this page's artists (the artist and its duplicates).
  const mbById = new Map(mbReleaseLinks.map(l => [l.release.id, l.release]))
  const connectedArtistByRelease = buildConnectedArtistByRelease(releaseLinks, connectedArtistById)

  const localRows = localReleases.map(r => ({ ...r, totalPlayCount: 0 }))
  const connectedSlugs = new Set(connectedArtists.map(a => a.slug))
  const coArtistMap = buildCoArtistMap(localRows, slug, connectedSlugs)

  // docs/sync_decisions.md: box sets in the catalogue that reprint any of this page's release groups - a pure
  // catalogue fact, independent of ownership. Batched once across every group id on the page.
  const releaseGroupIds = [...new Set([...mbById.values()].map(r => r.releaseGroupId).filter((id): id is string => !!id))]
  const alsoPartOfMedia = releaseGroupIds.length > 0
    ? await prisma.musicBrainzReleaseMedium.findMany({
      where: { equivalentReleaseGroupId: { in: releaseGroupIds } },
      select: { equivalentReleaseGroupId: true, releaseId: true, release: { select: { title: true, year: true, releaseGroupId: true } } },
    })
    : []
  const alsoPartOfByGroupId = new Map<string, AlsoPartOfEntry[]>()
  const alsoPartOfSeen = new Map<string, Set<string>>()
  accumulateAlsoPartOf(alsoPartOfMedia, alsoPartOfByGroupId, alsoPartOfSeen)

  const { cards: localAndGapCards, appearsOnLocal } = buildLocalAndGapCards({
    localReleases: localRows,
    mbById,
    coArtistMap,
    connectedArtistByRelease,
    resolveImage: verifyImage,
    alsoPartOfByGroupId,
  })

  // Appears-On: LocalReleases whose MB release is NOT in this artist's catalogue. Fetch those MB rows so the
  // cards get real type/year/status/trackCount.
  const appearsOnMbIds = appearsOnLocal.map(lr => lr.releaseId!)
  const appearsOnMbReleases = appearsOnMbIds.length > 0
    ? await prisma.musicBrainzRelease.findMany({ where: { id: { in: appearsOnMbIds } }, select: MB_RELEASE_CARD_SELECT })
    : []
  const appearsOnMbById = new Map(appearsOnMbReleases.map(r => [r.id, r]))

  const appearsOnGroupIds = [...new Set(appearsOnMbReleases.map(r => r.releaseGroupId).filter((id): id is string => !!id))]
    .filter(id => !alsoPartOfByGroupId.has(id))
  if (appearsOnGroupIds.length > 0) {
    const extraMedia = await prisma.musicBrainzReleaseMedium.findMany({
      where: { equivalentReleaseGroupId: { in: appearsOnGroupIds } },
      select: { equivalentReleaseGroupId: true, releaseId: true, release: { select: { title: true, year: true, releaseGroupId: true } } },
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

  return sortReleaseCards([...localAndGapCards, ...appearsOnCards])
}

// The local releases whose plays count toward a card: its own release, or - for a dissolved box, which has no
// LocalRelease of its own - every disc.
export const playReleaseIds = (card: Pick<UnifiedRelease, 'localReleaseId' | 'boxDiscReleaseIds'>): string[] =>
  card.localReleaseId ? [card.localReleaseId] : (card.boxDiscReleaseIds ?? [])

// Fills in the per-user play count on a cached, user-independent catalogue.
export const applyPlays = (
  cards: UnifiedRelease[],
  plays: Map<string, { totalPlayCount: number }>,
): UnifiedRelease[] =>
  cards.map(card => ({
    ...card,
    totalPlayCount: playReleaseIds(card).reduce((sum, id) => sum + (plays.get(id)?.totalPlayCount ?? 0), 0),
  }))

export interface CataloguePage {
  releases: UnifiedRelease[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

// `all` returns the whole catalogue as one page. The artist page needs every card - it groups editions of a
// release group, filters and counts across them - so the earlier "first 500" cut silently dropped the tail of
// large catalogues (Bach has ~5,800 MusicBrainz releases). Explicit paging stays for other callers.
export const pageCatalogue = (
  releases: UnifiedRelease[],
  paging: { page: number, pageSize: number, all: boolean },
): CataloguePage => {
  const total = releases.length
  if (paging.all) {
    return { releases, total, page: 1, pageSize: total, hasMore: false }
  }
  const start = (paging.page - 1) * paging.pageSize
  return {
    releases: releases.slice(start, start + paging.pageSize),
    total,
    page: paging.page,
    pageSize: paging.pageSize,
    hasMore: start + paging.pageSize < total,
  }
}
