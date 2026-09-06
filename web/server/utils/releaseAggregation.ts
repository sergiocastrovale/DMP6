// Pure aggregation core extracted from server/api/artists/[slug]/releases.get.ts. Takes already-fetched
// DB rows and produces the unified local/gap/appears-on release card list, isolating the
// shared-releaseId dedup/coverage logic (the systemic sync-matcher bug this app has) for direct unit
// testing without spinning up a database.

import type { MbReleaseRow, LocalReleaseRow, ImageResolver, UnifiedRelease, LocalAndGapCardsResult } from '~/types/release'

// Single-release field mapping shared by the batch card builders below and the single-release lookup
// endpoint (server/api/releases/[id].get.ts) - keeps `image`/`imageUrl`/type/format/etc. derivation in
// one place instead of re-deriving it per call site.
export function buildReleaseCard(
  lr: LocalReleaseRow,
  mbr: MbReleaseRow | null,
  resolveImage: ImageResolver,
  extras?: { coArtists?: { name: string, slug: string }[], connectedArtistName?: string },
): UnifiedRelease {
  const img = resolveImage(lr.image, lr.imageUrl, 'releases')
  if (!mbr) {
    return {
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
      status: lr.matchStatus as UnifiedRelease['status'],
      image: img.image,
      imageUrl: img.imageUrl,
      trackCount: 0,
      totalPlayCount: lr.totalPlayCount,
      localTrackCount: lr.tracks.length,
      isMusicBrainz: false,
      hasLocal: true,
      localReleaseId: lr.id,
      folderPath: lr.folderPath,
      coArtists: extras?.coArtists,
      connectedArtistName: extras?.connectedArtistName,
      discCount: null,
    }
  }
  return {
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
    status: mbr.status as UnifiedRelease['status'],
    image: img.image,
    imageUrl: img.imageUrl,
    trackCount: mbr.tracks.length,
    totalPlayCount: lr.totalPlayCount,
    localTrackCount: lr.tracks.length,
    isMusicBrainz: true,
    hasLocal: true,
    localReleaseId: lr.id,
    folderPath: lr.folderPath,
    coArtists: extras?.coArtists,
    statusReason: mbr.statusReason,
    connectedArtistName: extras?.connectedArtistName,
    discCount: mbr.mediumCount > 1 ? mbr.mediumCount : null,
  }
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
  const cards: UnifiedRelease[] = []
  const coveredMbIds = new Set<string>()
  const appearsOnLocal: LocalReleaseRow[] = []

  for (const lr of localReleases) {
    const extras = { coArtists: coArtistMap.get(lr.id), connectedArtistName: connectedArtistByRelease.get(lr.id) }
    if (!lr.releaseId) {
      cards.push(buildReleaseCard(lr, null, resolveImage, extras))
      continue
    }

    const mbr = mbById.get(lr.releaseId)
    if (!mbr) {
      appearsOnLocal.push(lr)
      continue
    }

    coveredMbIds.add(mbr.id)
    cards.push(buildReleaseCard(lr, mbr, resolveImage, extras))
  }

  for (const mbr of mbById.values()) {
    if (coveredMbIds.has(mbr.id)) {continue}
    if (!ALLOWED_GAP_TYPES.has(mbr.type.slug)) {continue}
    const gapImg = resolveImage(null, null, 'releases')
    // Tracks may be individually claimed into another folder's local release without this MB
    // release ever getting its own LocalRelease row (claim_owned_bundle, see CLAUDE.md) - detect
    // that via the mbTrackId reverse join so the card can still surface play/favorite/link actions.
    const linkedTracks = mbr.tracks.flatMap(t => t.localTracks ?? [])
    const bundleParentReleaseId = linkedTracks.find(t => t.localReleaseId)?.localReleaseId ?? null
    const linkedTrackCount = mbr.tracks.filter(t => (t.localTracks ?? []).length > 0).length
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
      status: mbr.status as UnifiedRelease['status'],
      image: gapImg.image,
      imageUrl: gapImg.imageUrl,
      trackCount: mbr.tracks.length,
      totalPlayCount: 0,
      localTrackCount: linkedTrackCount,
      isMusicBrainz: true,
      hasLocal: false,
      localReleaseId: null,
      bundleParentReleaseId,
      folderPath: null,
      statusReason: mbr.statusReason,
      discCount: mbr.mediumCount > 1 ? mbr.mediumCount : null,
    })
  }

  return { cards, coveredMbIds, appearsOnLocal }
}

// Goal 2 of docs/box_sets.md: a box-set disc is "the same as an edition, but living in a box" - so
// each medium `sync --link-box-editions` matched to a standalone album gets a virtual card whose
// `releaseGroupId` is that ALBUM's release group, not the box's own. useArtistCatalogue's grouper
// keys purely on `releaseGroupId`, so this card drops straight into that album's existing edition
// group with no change to the grouper itself. Virtual: it has no LocalRelease/MusicBrainzRelease row
// of its own - `id` is synthesized, `hasLocal`/`localTrackCount` are false/0 so it never renders as
// playable (the actual audio lives on the box's own card, reached via `boxParent`).
export function buildBoxEditionCards(
  mbById: Map<string, MbReleaseRow>,
  resolveImage: ImageResolver,
): UnifiedRelease[] {
  const cards: UnifiedRelease[] = []
  const img = resolveImage(null, null, 'releases')
  for (const mbr of mbById.values()) {
    if (mbr.mediumCount <= 1) {continue}
    for (const medium of mbr.media) {
      if (!medium.equivalentReleaseGroupId) {continue}
      cards.push({
        id: `${mbr.id}:medium:${medium.position}`,
        title: medium.title ?? mbr.title,
        year: mbr.year,
        type: mbr.type.name,
        typeSlug: mbr.type.slug,
        mbReleaseRowId: mbr.id,
        musicbrainzId: mbr.musicbrainzId,
        releaseGroupId: medium.equivalentReleaseGroupId,
        disambiguation: null,
        editionLabel: null,
        releaseDate: mbr.releaseDate,
        packaging: mbr.packaging,
        country: mbr.country,
        format: mbr.format,
        status: mbr.status as UnifiedRelease['status'],
        image: img.image,
        imageUrl: img.imageUrl,
        trackCount: 0,
        totalPlayCount: 0,
        localTrackCount: 0,
        isMusicBrainz: true,
        hasLocal: false,
        localReleaseId: null,
        folderPath: null,
        discCount: null,
        boxParent: { releaseId: mbr.id, title: mbr.title, mediumPosition: medium.position, mediumTitle: medium.title },
      })
    }
  }
  return cards
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
}): UnifiedRelease[] {
  const { appearsOnLocal, appearsOnMbById, coArtistMap, connectedArtistByRelease, resolveImage } = params
  return appearsOnLocal.map(lr => buildReleaseCard(lr, appearsOnMbById.get(lr.releaseId!) ?? null, resolveImage, {
    coArtists: coArtistMap.get(lr.id),
    connectedArtistName: connectedArtistByRelease.get(lr.id),
  }))
}

// The caller builds the unified list as locals+gaps (already year-ascending) followed by appears-on
// (unsorted, appended after). Sort the whole thing by year before paginating so page 2+ can't show an
// old gap release after a recent local one. Undated releases sort last. Stable sort (ES2019+) keeps
// same-year cards in their original relative order.
export function sortReleaseCards(cards: UnifiedRelease[]): UnifiedRelease[] {
  return [...cards].sort((a, b) => (a.year ?? Number.MAX_SAFE_INTEGER) - (b.year ?? Number.MAX_SAFE_INTEGER))
}
