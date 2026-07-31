// Pure aggregation core extracted from server/api/artists/[slug]/releases.get.ts. Takes already-fetched
// DB rows and produces the unified local/gap/appears-on release card list, isolating the
// shared-releaseId dedup/coverage logic (the systemic sync-matcher bug this app has) for direct unit
// testing without spinning up a database.

export interface MbReleaseRow {
  id: string
  title: string
  year: number | null
  musicbrainzId: string
  releaseGroupId: string | null
  disambiguation: string | null
  editionLabel: string | null
  releaseDate: string | null
  packaging: string | null
  country: string | null
  format: string | null
  status: string
  statusReason: string | null
  type: { name: string, slug: string }
  tracks: { id: string }[]
}

export interface LocalReleaseRow {
  id: string
  title: string
  year: number | null
  folderPath: string | null
  image: string | null
  imageUrl: string | null
  matchStatus: string
  releaseId: string | null
  totalPlayCount: number
  tracks: { id: string }[]
  artists: { artist: { name: string, slug: string } }[]
}

export interface ImageResolver {
  (image: string | null, imageUrl: string | null, kind: 'releases'): { image: string | null, imageUrl: string | null }
}

export interface ReleaseCard {
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
  coArtists?: { name: string, slug: string }[]
  statusReason?: string | null
  connectedArtistName?: string | null
  downloadState?: string | null
  downloadedReleaseId?: string | null
}

// For each local release, the names of other credited artists (excluding the page's own artist and
// any of its connected/duplicate artists) - shown as "feat. X" style co-artist chips.
export function buildCoArtistMap(
  localReleases: LocalReleaseRow[],
  slug: string,
  connectedSlugs: Set<string>,
): Map<string, { name: string, slug: string }[]> {
  const map = new Map<string, { name: string, slug: string }[]>()
  for (const lr of localReleases) {
    const others = lr.artists
      .map(a => a.artist)
      .filter(a => a.slug !== slug && !connectedSlugs.has(a.slug))
    if (others.length > 0) {
      map.set(lr.id, others)
    }
  }
  return map
}

// Which connected artist (if any) actually owns a given LocalReleaseArtist link, for the
// "via <connected artist>" badge.
export function buildConnectedArtistByRelease(
  releaseLinks: { localReleaseId: string, artistId: string }[],
  connectedArtistById: Map<string, { name: string }>,
): Map<string, string> {
  const map = new Map<string, string>()
  for (const link of releaseLinks) {
    const ca = connectedArtistById.get(link.artistId)
    if (ca) {map.set(link.localReleaseId, ca.name)}
  }
  return map
}

export interface LocalAndGapCardsResult {
  cards: ReleaseCard[]
  coveredMbIds: Set<string>
  appearsOnLocal: LocalReleaseRow[]
}

const ALLOWED_GAP_TYPES = new Set(['album', 'ep'])

// Loop 1 (local releases -> either a local card, an appears-on candidate, or matched to a catalogue
// MB release) followed by loop 2 (uncovered MB releases in this artist's catalogue -> MISSING gap
// cards). `mbById` MUST already be deduplicated by MusicBrainzRelease.id (one entry per release
// regardless of how many artist credits point at it) - the caller dedupes via a Map when fetching.
export function buildLocalAndGapCards(params: {
  localReleases: LocalReleaseRow[]
  mbById: Map<string, MbReleaseRow>
  coArtistMap: Map<string, { name: string, slug: string }[]>
  connectedArtistByRelease: Map<string, string>
  resolveImage: ImageResolver
}): LocalAndGapCardsResult {
  const { localReleases, mbById, coArtistMap, connectedArtistByRelease, resolveImage } = params
  const cards: ReleaseCard[] = []
  const coveredMbIds = new Set<string>()
  const appearsOnLocal: LocalReleaseRow[] = []

  for (const lr of localReleases) {
    const localImg = resolveImage(lr.image, lr.imageUrl, 'releases')
    if (!lr.releaseId) {
      cards.push({
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
    cards.push({
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

  for (const mbr of mbById.values()) {
    if (coveredMbIds.has(mbr.id)) {continue}
    if (!ALLOWED_GAP_TYPES.has(mbr.type.slug)) {continue}
    const gapImg = resolveImage(null, null, 'releases')
    cards.push({
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

  return { cards, coveredMbIds, appearsOnLocal }
}

// Loop 3: LocalReleases whose releaseId points outside this artist's own MB catalogue (a release
// credited on another artist's page - "Appears On"). `appearsOnMbById` is looked up by the caller in a
// second DB round-trip (it needs the ids discovered by buildLocalAndGapCards first), so this stays a
// separate pure step rather than folded into the function above.
export function buildAppearsOnCards(params: {
  appearsOnLocal: LocalReleaseRow[]
  appearsOnMbById: Map<string, MbReleaseRow>
  coArtistMap: Map<string, { name: string, slug: string }[]>
  connectedArtistByRelease: Map<string, string>
  resolveImage: ImageResolver
}): ReleaseCard[] {
  const { appearsOnLocal, appearsOnMbById, coArtistMap, connectedArtistByRelease, resolveImage } = params
  return appearsOnLocal.map((lr) => {
    const mbr = appearsOnMbById.get(lr.releaseId!)
    const img = resolveImage(lr.image, lr.imageUrl, 'releases')
    return {
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
      image: img.image,
      imageUrl: img.imageUrl,
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
    }
  })
}

// The caller builds the unified list as locals+gaps (already year-ascending) followed by appears-on
// (unsorted, appended after). Sort the whole thing by year before paginating so page 2+ can't show an
// old gap release after a recent local one. Undated releases sort last. Stable sort (ES2019+) keeps
// same-year cards in their original relative order.
export function sortReleaseCards(cards: ReleaseCard[]): ReleaseCard[] {
  return [...cards].sort((a, b) => (a.year ?? Number.MAX_SAFE_INTEGER) - (b.year ?? Number.MAX_SAFE_INTEGER))
}
