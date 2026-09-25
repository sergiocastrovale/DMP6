// Pure aggregation core extracted from server/api/artists/[slug]/releases.get.ts. Takes already-fetched
// DB rows and produces the unified local/gap/appears-on release card list, isolating the
// shared-releaseId dedup/coverage logic (the systemic sync-matcher bug this app has) for direct unit
// testing without spinning up a database.

import type { MbReleaseRow, LocalReleaseRow, ImageResolver, UnifiedRelease, LocalAndGapCardsResult } from '~/types/release'
import { containmentContainerTitle } from '~/helpers/functions'

// Single-release field mapping shared by the batch card builders below and the single-release lookup
// endpoint (server/api/releases/[id].get.ts) - keeps `image`/`imageUrl`/type/format/etc. derivation in
// one place instead of re-deriving it per call site.
// docs/sync_decisions.md: which box (if any) this local release's disc lives in, and which of the
// box's own media it is - either bound to an equivalent standalone album (boxMbr is the box, mbr is
// the album) or bound directly to the box itself as a rarities/no-equivalent disc (mbr IS the box,
// no separate boxMbr needed). Pure, no I/O, so it's unit-testable in isolation from the DB layer.
//
// `mediumPosition` is renumbered sequentially (1-based rank in the box's own ascending-ordered
// `media` list), never the raw stored MB position: `is_audio_medium` filters video media out of a
// box's medium rows but deliberately does not renumber (flatten_audio_tracks's own contract, see
// CLAUDE.md), so a box that interleaves audio with a bonus video disc has real gaps in its stored
// positions (e.g. discs 1, 2, 4, 5) - showing "disc 4 of 4" would raise the obvious "where's 3?".
const computeBoxParent = (
  lr: LocalReleaseRow,
  mbr: MbReleaseRow,
  boxMbr: MbReleaseRow | null | undefined,
): UnifiedRelease['boxParent'] => {
  if (lr.boxReleaseId && boxMbr && lr.boxMediumPosition != null) {
    const idx = boxMbr.media.findIndex(m => m.position === lr.boxMediumPosition)
    if (idx === -1) { return null }
    return {
      releaseId: boxMbr.id,
      title: boxMbr.title,
      mediumPosition: idx + 1,
      mediumTitle: boxMbr.media[idx]!.title ?? null,
      mediumCount: boxMbr.mediumCount,
    }
  }
  if (lr.mediumPosition != null && mbr.mediumCount > 1 && !lr.boxReleaseId) {
    // Bound directly to the box (a rarities/no-equivalent disc) - mbr IS the box. `releaseId ===
    // mbr.id` here is also the self-reference isBoxSetRow() (helpers/artistPageLogic.ts) uses to
    // tell this case apart from a dissolved disc bound to a *different* release.
    const idx = mbr.media.findIndex(m => m.position === lr.mediumPosition)
    if (idx === -1) { return null }
    return {
      releaseId: mbr.id,
      title: mbr.title,
      mediumPosition: idx + 1,
      mediumTitle: mbr.media[idx]!.title ?? null,
      mediumCount: mbr.mediumCount,
    }
  }
  return null
}

export const buildReleaseCard = (
  lr: LocalReleaseRow,
  mbr: MbReleaseRow | null,
  resolveImage: ImageResolver,
  extras?: { coArtists?: { name: string, slug: string }[], connectedArtistName?: string, boxMbr?: MbReleaseRow | null, alsoPartOf?: { title: string, year: number | null }[] },
): UnifiedRelease => {
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
      statusReason: lr.statusReason,
      connectedArtistName: extras?.connectedArtistName,
      discCount: null,
    }
  }
  const boxParent = computeBoxParent(lr, mbr, extras?.boxMbr)
  // A rarities/no-equivalent box disc self-references (boxParent.releaseId === mbr.id, since mbr IS
  // the box) - its row title borrows the box's medium title so several such discs from the same box
  // don't all render under the box's own bare title (docs/sync_decisions.md).
  const isBoxSetRow = boxParent?.releaseId === mbr.id
  const title = isBoxSetRow ? `${mbr.title} — ${boxParent!.mediumTitle ?? `Disc ${boxParent!.mediumPosition}`}` : mbr.title
  return {
    id: lr.id,
    title,
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
    // A dissolved box disc's own row represents ONE disc, not the whole release - the "N discs"
    // pill belongs only on a folded multi-disc release's single survivor row (docs/sync_decisions.md).
    discCount: mbr.mediumCount > 1 && lr.mediumPosition == null ? mbr.mediumCount : null,
    boxParent,
    alsoPartOf: extras?.alsoPartOf,
  }
}

// For each local release, the names of other credited artists (excluding the page's own artist and
// any of its connected/duplicate artists) - shown as "feat. X" style co-artist chips.
export const buildCoArtistMap = (
  localReleases: LocalReleaseRow[],
  slug: string,
  connectedSlugs: Set<string>,
): Map<string, { name: string, slug: string }[]> => {
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
export const buildConnectedArtistByRelease = (
  releaseLinks: { localReleaseId: string, artistId: string }[],
  connectedArtistById: Map<string, { name: string }>,
): Map<string, string> => {
  const map = new Map<string, string>()
  for (const link of releaseLinks) {
    const ca = connectedArtistById.get(link.artistId)
    if (ca) {map.set(link.localReleaseId, ca.name)}
  }
  return map
}

// docs/sync_decisions.md §9: a box set is ONE MusicBrainzRelease with N MusicBrainzReleaseMedium rows
// (one per disc), and each disc row carries the SAME equivalentReleaseGroupId, so entries are deduped by
// releaseId. A medium whose own release belongs to the group it points at is an edition of that group,
// not a box reprinting it, and is skipped. Mutates `byGroupId`/`seen` in place so multiple fetches
// accumulate into one shared map.
export const accumulateAlsoPartOf = (
  media: { equivalentReleaseGroupId: string | null, releaseId: string, release: { title: string, year: number | null, releaseGroupId?: string | null } }[],
  byGroupId: Map<string, { title: string, year: number | null }[]>,
  seen: Map<string, Set<string>>,
): void => {
  for (const m of media) {
    if (!m.equivalentReleaseGroupId) {continue}
    const groupId = m.equivalentReleaseGroupId
    if (m.release.releaseGroupId === groupId) {continue}
    const seenForGroup = seen.get(groupId) ?? new Set<string>()
    seen.set(groupId, seenForGroup)
    if (seenForGroup.has(m.releaseId)) {continue}
    seenForGroup.add(m.releaseId)
    const entry = { title: m.release.title, year: m.release.year }
    const list = byGroupId.get(groupId)
    if (list) { list.push(entry) } else { byGroupId.set(groupId, [entry]) }
  }
}

const ALLOWED_GAP_TYPES = new Set(['album', 'ep'])

// Loop 1 (local releases -> either a local card, an appears-on candidate, or matched to a catalogue
// MB release) followed by loop 2 (uncovered MB releases in this artist's catalogue -> MISSING gap
// cards). `mbById` MUST already be deduplicated by MusicBrainzRelease.id (one entry per release
// regardless of how many artist credits point at it) - the caller dedupes via a Map when fetching.
export const buildLocalAndGapCards = (params: {
  localReleases: LocalReleaseRow[]
  mbById: Map<string, MbReleaseRow>
  coArtistMap: Map<string, { name: string, slug: string }[]>
  connectedArtistByRelease: Map<string, string>
  resolveImage: ImageResolver
  alsoPartOfByGroupId?: Map<string, { title: string, year: number | null }[]>
}): LocalAndGapCardsResult => {
  const { localReleases, mbById, coArtistMap, connectedArtistByRelease, resolveImage, alsoPartOfByGroupId } = params
  const cards: UnifiedRelease[] = []
  const coveredMbIds = new Set<string>()
  const appearsOnLocal: LocalReleaseRow[] = []

  for (const lr of localReleases) {
    const extras = {
      coArtists: coArtistMap.get(lr.id),
      connectedArtistName: connectedArtistByRelease.get(lr.id),
      boxMbr: lr.boxReleaseId ? mbById.get(lr.boxReleaseId) ?? null : null,
      alsoPartOf: lr.releaseId ? alsoPartOfByGroupId?.get(mbById.get(lr.releaseId)?.releaseGroupId ?? '') : undefined,
    }
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

  // A dissolved box has no LocalRelease of its own - each disc binds to the album it reprints - so it
  // lands here as a gap. Its discs still hold every file, so the row borrows their cover, track count
  // and plays, which is what makes it expandable/playable (the tracks endpoint re-links the discs).
  const boxDiscsByBoxId = new Map<string, LocalReleaseRow[]>()
  for (const lr of localReleases) {
    if (!lr.boxReleaseId) {continue}
    boxDiscsByBoxId.set(lr.boxReleaseId, [...(boxDiscsByBoxId.get(lr.boxReleaseId) ?? []), lr])
  }

  for (const mbr of mbById.values()) {
    if (coveredMbIds.has(mbr.id)) {continue}
    if (!ALLOWED_GAP_TYPES.has(mbr.type.slug)) {continue}
    const boxDiscs = [...(boxDiscsByBoxId.get(mbr.id) ?? [])]
      .sort((a, b) => (a.boxMediumPosition ?? 0) - (b.boxMediumPosition ?? 0))
    const firstDisc = boxDiscs[0]
    const gapImg = resolveImage(firstDisc?.image ?? null, firstDisc?.imageUrl ?? null, 'releases')
    // A gap whose every track already sits inside a bigger local release carries a containment note
    // (scripts/sync/src/owned.rs). It stays a gap - a box set's rendition of an album is not that
    // album - but the note names the container, which we resolve to its local release so the card can
    // link across to it.
    const containerTitle = containmentContainerTitle(mbr.statusReason)
    const bundleParentReleaseId = containerTitle
      ? localReleases.find(lr => lr.title === containerTitle)?.id ?? null
      : null
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
      totalPlayCount: boxDiscs.reduce((sum, d) => sum + d.totalPlayCount, 0),
      localTrackCount: boxDiscs.reduce((sum, d) => sum + d.tracks.length, 0),
      isMusicBrainz: true,
      hasLocal: false,
      localReleaseId: null,
      bundleParentReleaseId,
      folderPath: null,
      statusReason: mbr.statusReason,
      discCount: mbr.mediumCount > 1 ? mbr.mediumCount : null,
      alsoPartOf: mbr.releaseGroupId ? alsoPartOfByGroupId?.get(mbr.releaseGroupId) : undefined,
    })
  }

  return { cards, coveredMbIds, appearsOnLocal }
}

// Loop 3: LocalReleases whose releaseId points outside this artist's own MB catalogue (a release
// credited on another artist's page - "Appears On"). `appearsOnMbById` is looked up by the caller in a
// second DB round-trip (it needs the ids discovered by buildLocalAndGapCards first), so this stays a
// separate pure step rather than folded into the function above.
export const buildAppearsOnCards = (params: {
  appearsOnLocal: LocalReleaseRow[]
  appearsOnMbById: Map<string, MbReleaseRow>
  coArtistMap: Map<string, { name: string, slug: string }[]>
  connectedArtistByRelease: Map<string, string>
  resolveImage: ImageResolver
  alsoPartOfByGroupId?: Map<string, { title: string, year: number | null }[]>
}): UnifiedRelease[] => {
  const { appearsOnLocal, appearsOnMbById, coArtistMap, connectedArtistByRelease, resolveImage, alsoPartOfByGroupId } = params
  return appearsOnLocal.map((lr) => {
    const mbr = appearsOnMbById.get(lr.releaseId!) ?? null
    return buildReleaseCard(lr, mbr, resolveImage, {
      coArtists: coArtistMap.get(lr.id),
      connectedArtistName: connectedArtistByRelease.get(lr.id),
      boxMbr: lr.boxReleaseId ? appearsOnMbById.get(lr.boxReleaseId) ?? null : null,
      alsoPartOf: mbr?.releaseGroupId ? alsoPartOfByGroupId?.get(mbr.releaseGroupId) : undefined,
    })
  })
}

// The caller builds the unified list as locals+gaps (already year-ascending) followed by appears-on
// (unsorted, appended after). Sort the whole thing by year before paginating so page 2+ can't show an
// old gap release after a recent local one. Undated releases sort last. Stable sort (ES2019+) keeps
// same-year cards in their original relative order.
export const sortReleaseCards = (cards: UnifiedRelease[]): UnifiedRelease[] => {
  return [...cards].sort((a, b) => (a.year ?? Number.MAX_SAFE_INTEGER) - (b.year ?? Number.MAX_SAFE_INTEGER))
}
