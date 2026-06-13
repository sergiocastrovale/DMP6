import { prisma } from '~/server/utils/prisma'
import { verifyImage } from '~/server/utils/images'
import { parsePagination } from '~/server/utils/pagination'

export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) throw createError({ statusCode: 400, statusMessage: 'Missing slug' })

  const query = getQuery(event)
  const { page, pageSize } = parsePagination(query, { defaultSize: 20, maxSize: 500 })

  const artist = await prisma.artist.findUnique({
    where: { slug },
    select: { id: true },
  })

  if (!artist) throw createError({ statusCode: 404, statusMessage: 'Artist not found' })

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
  const connectedArtistByRelease = new Map<string, string>()
  for (const link of releaseLinks) {
    const ca = connectedArtistById.get(link.artistId)
    if (ca) {
      connectedArtistByRelease.set(link.localReleaseId, ca.name)
    }
  }

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
    },
    orderBy: [{ year: 'asc' }, { title: 'asc' }],
  })

  // Build co-artist map: for each local release, list other artists (excluding current + connected)
  const connectedSlugs = new Set(connectedArtists.map(a => a.slug))
  const coArtistMap = new Map<string, { name: string; slug: string }[]>()
  for (const lr of localReleases) {
    const others = lr.artists
      .map(a => a.artist)
      .filter(a => a.slug !== slug && !connectedSlugs.has(a.slug))
    if (others.length > 0) {
      coArtistMap.set(lr.id, others)
    }
  }

  type ReleaseCard = {
    id: string
    title: string
    year: number | null
    type: string
    typeSlug: string
    mbReleaseRowId: string | null
    musicbrainzId: string | null
    releaseGroupId: string | null
    disambiguation: string | null
    editionLabel: string | null
    releaseDate: string | null
    packaging: string | null
    country: string | null
    format: string | null
    status: string
    image: string | null
    imageUrl: string | null
    trackCount: number
    totalPlayCount: number
    localTrackCount: number
    isMusicBrainz: boolean
    hasLocal: boolean
    localReleaseId: string | null
    folderPath: string | null
    coArtists?: { name: string; slug: string }[]
    statusReason?: string | null
    connectedArtistName?: string | null
    downloadState?: string | null
    downloadedReleaseId?: string | null
  }

  const releases: ReleaseCard[] = []
  const coveredMbIds = new Set<string>()
  const appearsOnLocal: typeof localReleases = []

  for (const lr of localReleases) {
    const localImg = verifyImage(lr.image, lr.imageUrl, 'releases')
    if (!lr.releaseId) {
      releases.push({
        id: lr.id,
        title: lr.title,
        year: lr.year,
        type: 'Album',
        typeSlug: 'album',
        mbReleaseRowId: null,
        musicbrainzId: null,
        releaseGroupId: null,
        disambiguation: null,
        editionLabel: null,
        releaseDate: null,
        packaging: null,
        country: null,
        format: null,
        status: lr.matchStatus,
        image: localImg.image,
        imageUrl: localImg.imageUrl,
        trackCount: 0,
        totalPlayCount: lr.totalPlayCount,
        localTrackCount: lr.tracks.length,
        isMusicBrainz: false,
        hasLocal: true,
        localReleaseId: lr.id,
        folderPath: lr.folderPath,
        coArtists: coArtistMap.get(lr.id),
        connectedArtistName: connectedArtistByRelease.get(lr.id),
      })
      continue
    }

    const mbr = mbById.get(lr.releaseId)
    if (!mbr) {
      appearsOnLocal.push(lr)
      continue
    }

    coveredMbIds.add(mbr.id)
    releases.push({
      id: lr.id,
      title: mbr.title,
      year: mbr.year,
      type: mbr.type.name,
      typeSlug: mbr.type.slug,
      mbReleaseRowId: mbr.id,
      musicbrainzId: mbr.musicbrainzId,
      releaseGroupId: mbr.releaseGroupId ?? null,
      disambiguation: mbr.disambiguation ?? null,
      editionLabel: mbr.editionLabel ?? null,
      releaseDate: mbr.releaseDate ?? null,
      packaging: mbr.packaging ?? null,
      country: mbr.country ?? null,
      format: mbr.format ?? null,
      status: mbr.status,
      image: localImg.image,
      imageUrl: localImg.imageUrl,
      trackCount: mbr.tracks.length,
      totalPlayCount: lr.totalPlayCount,
      localTrackCount: lr.tracks.length,
      isMusicBrainz: true,
      hasLocal: true,
      localReleaseId: lr.id,
      folderPath: lr.folderPath,
      coArtists: coArtistMap.get(lr.id),
      statusReason: mbr.statusReason,
      connectedArtistName: connectedArtistByRelease.get(lr.id),
    })
  }

  // Catalogue gaps: MB releases in this artist's catalogue that have no LocalRelease.
  const allowedGapTypes = new Set(['album', 'ep'])
  for (const mbr of mbReleases) {
    if (coveredMbIds.has(mbr.id)) continue
    if (!allowedGapTypes.has(mbr.type.slug)) continue
    const gapImg = verifyImage(null, null, 'releases')
    releases.push({
      id: mbr.id,
      title: mbr.title,
      year: mbr.year,
      type: mbr.type.name,
      typeSlug: mbr.type.slug,
      mbReleaseRowId: mbr.id,
      musicbrainzId: mbr.musicbrainzId,
      releaseGroupId: mbr.releaseGroupId ?? null,
      disambiguation: mbr.disambiguation ?? null,
      editionLabel: mbr.editionLabel ?? null,
      releaseDate: mbr.releaseDate ?? null,
      packaging: mbr.packaging ?? null,
      country: mbr.country ?? null,
      format: mbr.format ?? null,
      status: mbr.status,
      image: gapImg.image,
      imageUrl: gapImg.imageUrl,
      trackCount: mbr.tracks.length,
      totalPlayCount: 0,
      localTrackCount: 0,
      isMusicBrainz: true,
      hasLocal: false,
      localReleaseId: null,
      folderPath: null,
      statusReason: mbr.statusReason,
    })
  }

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
        type: { select: { name: true, slug: true } },
        tracks: { select: { id: true } },
      },
    })
    : []
  const appearsOnMbMap = new Map(appearsOnMbReleases.map(r => [r.id, r]))

  for (const lr of appearsOnLocal) {
    const mbr = appearsOnMbMap.get(lr.releaseId!)
    const appearsOnImg = verifyImage(lr.image, lr.imageUrl, 'releases')
    releases.push({
      id: lr.id,
      title: mbr?.title ?? lr.title,
      year: mbr?.year ?? lr.year,
      type: mbr ? mbr.type.name : 'Album',
      typeSlug: mbr ? mbr.type.slug : 'album',
      mbReleaseRowId: mbr?.id ?? null,
      musicbrainzId: mbr?.musicbrainzId ?? null,
      releaseGroupId: mbr?.releaseGroupId ?? null,
      disambiguation: mbr?.disambiguation ?? null,
      editionLabel: mbr?.editionLabel ?? null,
      releaseDate: mbr?.releaseDate ?? null,
      packaging: mbr?.packaging ?? null,
      country: mbr?.country ?? null,
      format: mbr?.format ?? null,
      status: mbr?.status ?? lr.matchStatus,
      image: appearsOnImg.image,
      imageUrl: appearsOnImg.imageUrl,
      trackCount: mbr?.tracks.length ?? 0,
      totalPlayCount: lr.totalPlayCount,
      localTrackCount: lr.tracks.length,
      isMusicBrainz: !!mbr,
      hasLocal: true,
      localReleaseId: lr.id,
      folderPath: lr.folderPath,
      coArtists: coArtistMap.get(lr.id),
      statusReason: mbr?.statusReason ?? null,
      connectedArtistName: connectedArtistByRelease.get(lr.id),
    })
  }

  // Paginate the unified list
  const total = releases.length
  const start = (page - 1) * pageSize
  const paged = releases.slice(start, start + pageSize)

  // Attach in-flight download state (acquisition pipeline) for the paged cards.
  // PROMOTED/REJECTED are excluded on purpose: promoted shows as a real local release,
  // rejected reverts to plain MISSING.
  const pagedMbIds = paged.map(r => r.mbReleaseRowId).filter((v): v is string => !!v)
  if (pagedMbIds.length > 0) {
    const dls = await prisma.downloadedRelease.findMany({
      where: {
        mbReleaseId: { in: pagedMbIds },
        status: { in: ['DOWNLOADING', 'PENDING', 'APPROVED', 'FAILED', 'ABANDONED'] },
      },
      select: { id: true, mbReleaseId: true, status: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    })
    const dlByMb = new Map<string, { id: string; status: string }>()
    for (const d of dls) {
      if (d.mbReleaseId && !dlByMb.has(d.mbReleaseId)) dlByMb.set(d.mbReleaseId, { id: d.id, status: d.status })
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
