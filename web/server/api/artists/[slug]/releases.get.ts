import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing slug' })

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(50, Math.max(1, Number(query.pageSize) || 20))

  const artist = await prisma.artist.findUnique({
    where: { slug },
    select: {
      id: true,
      mbReleases: {
        select: {
          id: true,
          title: true,
          year: true,
          musicbrainzId: true,
          status: true,
          statusReason: true,
          type: { select: { name: true, slug: true } },
          tracks: { select: { id: true } },
          localReleases: {
            select: {
              id: true,
              title: true,
              image: true,
              imageUrl: true,
              totalPlayCount: true,
              tracks: { select: { id: true } },
            },
          },
        },
        orderBy: [{ year: 'asc' }, { title: 'asc' }],
      },
    },
  })

  if (!artist) throw createError({ statusCode: 404, statusMessage: 'Artist not found' })

  // Get all local releases for this artist (via LocalReleaseArtist junction)
  const releaseLinks = await prisma.localReleaseArtist.findMany({
    where: { artistId: artist.id },
    select: { localReleaseId: true },
  })
  const releaseIds = [...new Set(releaseLinks.map(l => l.localReleaseId))]

  const localReleases = await prisma.localRelease.findMany({
    where: { id: { in: releaseIds } },
    select: {
      id: true,
      title: true,
      year: true,
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
    },
    orderBy: [{ year: 'asc' }, { title: 'asc' }],
  })

  // Build co-artist map: for each local release, list other artists (excluding current)
  const coArtistMap = new Map<string, { name: string; slug: string }[]>()
  for (const lr of localReleases) {
    const others = lr.artists
      .map(a => a.artist)
      .filter(a => a.slug !== slug)
    if (others.length > 0) {
      coArtistMap.set(lr.id, others)
    }
  }

  // Index local releases by their MB releaseId
  const localByMbId = new Map<string, typeof localReleases[number]>()
  const unmatchedLocal: typeof localReleases = []
  for (const lr of localReleases) {
    if (lr.releaseId) {
      localByMbId.set(lr.releaseId, lr)
    } else {
      unmatchedLocal.push(lr)
    }
  }

  // Build unified release list
  const releases: Array<{
    id: string
    title: string
    year: number | null
    type: string
    typeSlug: string
    musicbrainzId: string | null
    status: string
    image: string | null
    imageUrl: string | null
    trackCount: number
    totalPlayCount: number
    localTrackCount: number
    isMusicBrainz: boolean
    localReleaseId: string | null
    coArtists?: { name: string; slug: string }[]
    statusReason?: string | null
  }> = []

  const mbLinkedReleaseIds = new Set<string>()

  for (const mbr of artist.mbReleases) {
    const localRelease = localByMbId.get(mbr.id) || mbr.localReleases[0] || null
    if (localRelease) mbLinkedReleaseIds.add(localRelease.id)
    releases.push({
      id: mbr.id,
      title: mbr.title,
      year: mbr.year,
      type: mbr.type.name,
      typeSlug: mbr.type.slug,
      musicbrainzId: mbr.musicbrainzId,
      status: mbr.status,
      image: localRelease?.image || null,
      imageUrl: localRelease?.imageUrl || null,
      trackCount: mbr.tracks.length,
      totalPlayCount: localRelease?.totalPlayCount || 0,
      localTrackCount: localRelease?.tracks.length || 0,
      isMusicBrainz: true,
      localReleaseId: localRelease?.id || null,
      coArtists: localRelease ? coArtistMap.get(localRelease.id) : undefined,
      statusReason: mbr.statusReason,
    })
  }

  // Add unmatched local releases
  for (const lr of unmatchedLocal) {
    if (mbLinkedReleaseIds.has(lr.id)) continue
    releases.push({
      id: lr.id,
      title: lr.title,
      year: lr.year,
      type: 'Unmatched',
      typeSlug: 'unmatched',
      musicbrainzId: null,
      status: lr.matchStatus,
      image: lr.image,
      imageUrl: lr.imageUrl,
      trackCount: 0,
      totalPlayCount: lr.totalPlayCount,
      localTrackCount: lr.tracks.length,
      isMusicBrainz: false,
      localReleaseId: lr.id,
      coArtists: coArtistMap.get(lr.id),
    })
  }

  // Add collaboration albums (local releases linked to MB releases not in this artist's catalogue)
  // Fetch the linked MB release data so "Appears On" entries get real type/year/status/trackCount
  const mbReleaseIds = new Set(artist.mbReleases.map(mbr => mbr.id))
  const appearsOnCandidates = localReleases.filter(
    lr => lr.releaseId && !mbReleaseIds.has(lr.releaseId) && !mbLinkedReleaseIds.has(lr.id),
  )
  const appearsOnMbIds = appearsOnCandidates.map(lr => lr.releaseId!)
  const appearsOnMbReleases = appearsOnMbIds.length > 0
    ? await prisma.musicBrainzRelease.findMany({
      where: { id: { in: appearsOnMbIds } },
      select: {
        id: true,
        year: true,
        status: true,
        statusReason: true,
        type: { select: { name: true, slug: true } },
        tracks: { select: { id: true } },
      },
    })
    : []
  const appearsOnMbMap = new Map(appearsOnMbReleases.map(r => [r.id, r]))

  for (const lr of appearsOnCandidates) {
    const mbr = appearsOnMbMap.get(lr.releaseId!)
    releases.push({
      id: mbr?.id ?? lr.id,
      title: lr.title,
      year: mbr?.year ?? lr.year,
      type: mbr ? mbr.type.name : 'Appears On',
      typeSlug: mbr ? mbr.type.slug : 'appears-on',
      musicbrainzId: null,
      status: mbr?.status ?? lr.matchStatus,
      image: lr.image,
      imageUrl: lr.imageUrl,
      trackCount: mbr?.tracks.length ?? 0,
      totalPlayCount: lr.totalPlayCount,
      localTrackCount: lr.tracks.length,
      isMusicBrainz: !!mbr,
      localReleaseId: lr.id,
      coArtists: coArtistMap.get(lr.id),
      statusReason: mbr?.statusReason ?? null,
    })
  }

  // Paginate the unified list
  const total = releases.length
  const start = (page - 1) * pageSize
  const paged = releases.slice(start, start + pageSize)

  return {
    releases: paged,
    total,
    page,
    pageSize,
    hasMore: start + pageSize < total,
  }
})
