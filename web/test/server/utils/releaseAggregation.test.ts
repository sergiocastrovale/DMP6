import { describe, expect, it } from 'vitest'
import {
  buildAppearsOnCards,
  buildCoArtistMap,
  buildConnectedArtistByRelease,
  buildLocalAndGapCards,
  type ReleaseCard,
  sortReleaseCards,
  type LocalReleaseRow,
  type MbReleaseRow,
} from '../../../server/utils/releaseAggregation'

const resolveImage = (image: string | null, imageUrl: string | null) => ({ image, imageUrl })

const mbRelease = (overrides: Partial<MbReleaseRow> & { id: string }): MbReleaseRow => ({
  title: 'Untitled',
  year: 2000,
  musicbrainzId: `mbid-${overrides.id}`,
  releaseGroupId: null,
  disambiguation: null,
  editionLabel: null,
  releaseDate: null,
  packaging: null,
  country: null,
  format: null,
  status: 'COMPLETE',
  statusReason: null,
  type: { name: 'Album', slug: 'album' },
  tracks: [{ id: 't1' }],
  ...overrides,
})

const localRelease = (overrides: Partial<LocalReleaseRow> & { id: string }): LocalReleaseRow => ({
  title: 'Untitled Local',
  year: 2000,
  folderPath: null,
  image: null,
  imageUrl: null,
  matchStatus: 'UNMATCHED',
  releaseId: null,
  totalPlayCount: 0,
  tracks: [],
  artists: [],
  ...overrides,
})

describe('buildCoArtistMap', () => {
  it('lists co-credited artists excluding the page artist and connected artists', () => {
    const lr = localRelease({
      id: 'lr1',
      artists: [
        { artist: { name: 'Main', slug: 'main' } },
        { artist: { name: 'Guest', slug: 'guest' } },
        { artist: { name: 'Connected', slug: 'connected' } },
      ],
    })
    const map = buildCoArtistMap([lr], 'main', new Set(['connected']))
    expect(map.get('lr1')).toEqual([{ name: 'Guest', slug: 'guest' }])
  })

  it('omits releases with no other credited artists', () => {
    const lr = localRelease({ id: 'lr1', artists: [{ artist: { name: 'Main', slug: 'main' } }] })
    const map = buildCoArtistMap([lr], 'main', new Set())
    expect(map.has('lr1')).toBe(false)
  })
})

describe('buildConnectedArtistByRelease', () => {
  it('maps a release to the connected artist that owns the credit link', () => {
    const connectedById = new Map([['artist-2', { name: 'Connected Name' }]])
    const map = buildConnectedArtistByRelease(
      [{ localReleaseId: 'lr1', artistId: 'artist-2' }],
      connectedById,
    )
    expect(map.get('lr1')).toBe('Connected Name')
  })

  it('ignores links to the primary artist (not in connectedById)', () => {
    const map = buildConnectedArtistByRelease([{ localReleaseId: 'lr1', artistId: 'primary' }], new Map())
    expect(map.has('lr1')).toBe(false)
  })
})

describe('buildLocalAndGapCards - core aggregation', () => {
  it('produces a local card with hasLocal=true, isMusicBrainz=false when there is no releaseId', () => {
    const lr = localRelease({ id: 'lr1', releaseId: null, title: 'Unmatched Album' })
    const { cards, coveredMbIds, appearsOnLocal } = buildLocalAndGapCards({
      localReleases: [lr], mbById: new Map(), coArtistMap: new Map(), connectedArtistByRelease: new Map(), resolveImage,
    })
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ hasLocal: true, isMusicBrainz: false, localReleaseId: 'lr1' })
    expect(coveredMbIds.size).toBe(0)
    expect(appearsOnLocal).toEqual([])
  })

  it('matches a local release to its MB release and marks the MB id covered', () => {
    const mb = mbRelease({ id: 'mb1', title: 'Geogaddi' })
    const lr = localRelease({ id: 'lr1', releaseId: 'mb1' })
    const { cards, coveredMbIds } = buildLocalAndGapCards({
      localReleases: [lr], mbById: new Map([['mb1', mb]]), coArtistMap: new Map(), connectedArtistByRelease: new Map(), resolveImage,
    })
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ title: 'Geogaddi', hasLocal: true, isMusicBrainz: true, mbReleaseRowId: 'mb1' })
    expect(coveredMbIds.has('mb1')).toBe(true)
  })

  it('THE SHARED-releaseId BUG: two unrelated LocalReleases pointing at the same MB id both render as covering it', () => {
    // This is the documented systemic sync-matcher bug (13k+ affected rows in prod): the DB has no
    // unique constraint on LocalRelease.releaseId, so two different local folders can carry the same
    // releaseId. Both cards render as "hasLocal" for the same MB release, and the gap loop sees it as
    // covered from either one - a real gap could be masked if the "wrong" duplicate is the one that
    // happens to match, but here we assert the current (buggy) behavior precisely so a fix is a
    // deliberate, visible diff against this test rather than a silent regression either way.
    const mb = mbRelease({ id: 'shared-mb', title: 'Shared Release' })
    const lrA = localRelease({ id: 'lrA', releaseId: 'shared-mb' })
    const lrB = localRelease({ id: 'lrB', releaseId: 'shared-mb' })
    const { cards, coveredMbIds } = buildLocalAndGapCards({
      localReleases: [lrA, lrB], mbById: new Map([['shared-mb', mb]]), coArtistMap: new Map(), connectedArtistByRelease: new Map(), resolveImage,
    })
    // Both local rows render as separate "hasLocal" cards for the same underlying MB release.
    const localCards = cards.filter(c => c.hasLocal)
    expect(localCards).toHaveLength(2)
    expect(localCards.map(c => c.mbReleaseRowId)).toEqual(['shared-mb', 'shared-mb'])
    // coveredMbIds is a Set, so it collapses to one entry regardless of how many locals claimed it -
    // meaning a genuinely different unmatched release could never independently "double count" here,
    // but a real gap for a *different* uncovered MB release cannot be masked by this one being covered
    // twice - the risk is entirely the duplicate-card rendering asserted above.
    expect(coveredMbIds.size).toBe(1)
  })

  it('a covered MB release never also emits a MISSING gap card', () => {
    const mb = mbRelease({ id: 'mb1' })
    const lr = localRelease({ id: 'lr1', releaseId: 'mb1' })
    const { cards } = buildLocalAndGapCards({
      localReleases: [lr], mbById: new Map([['mb1', mb]]), coArtistMap: new Map(), connectedArtistByRelease: new Map(), resolveImage,
    })
    expect(cards.filter(c => !c.hasLocal)).toHaveLength(0)
  })

  it('an uncovered MB release (album/ep type) becomes a MISSING gap card', () => {
    const mb = mbRelease({ id: 'mb1', type: { name: 'Album', slug: 'album' } })
    const { cards } = buildLocalAndGapCards({
      localReleases: [], mbById: new Map([['mb1', mb]]), coArtistMap: new Map(), connectedArtistByRelease: new Map(), resolveImage,
    })
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ hasLocal: false, isMusicBrainz: true, mbReleaseRowId: 'mb1' })
  })

  it('non-album/ep types (e.g. single, compilation) never generate a gap card', () => {
    const mb = mbRelease({ id: 'mb1', type: { name: 'Single', slug: 'single' } })
    const { cards } = buildLocalAndGapCards({
      localReleases: [], mbById: new Map([['mb1', mb]]), coArtistMap: new Map(), connectedArtistByRelease: new Map(), resolveImage,
    })
    expect(cards).toHaveLength(0)
  })

  it('mbById already deduplicated by id means a release credited to several connected artists collapses to a single gap card', () => {
    // The caller is responsible for building mbById as a Map keyed by MB release id (deduping multiple
    // MusicBrainzReleaseArtist credit rows down to one entry) before calling this function - simulating
    // that here with a single-entry map proves the loop itself only ever emits one card per id.
    const mb = mbRelease({ id: 'mb1' })
    const { cards } = buildLocalAndGapCards({
      localReleases: [], mbById: new Map([['mb1', mb]]), coArtistMap: new Map(), connectedArtistByRelease: new Map(), resolveImage,
    })
    expect(cards).toHaveLength(1)
  })

  it('a releaseId with no matching mbById entry (deleted/retired MB row) is routed to appearsOnLocal, not dropped', () => {
    const lr = localRelease({ id: 'lr1', releaseId: 'ghost-mb-id' })
    const { cards, appearsOnLocal } = buildLocalAndGapCards({
      localReleases: [lr], mbById: new Map(), coArtistMap: new Map(), connectedArtistByRelease: new Map(), resolveImage,
    })
    expect(cards).toHaveLength(0)
    expect(appearsOnLocal).toEqual([lr])
  })

  it('attaches coArtists and connectedArtistName from the pre-built maps', () => {
    const lr = localRelease({ id: 'lr1', releaseId: null })
    const coArtistMap = new Map([['lr1', [{ name: 'Feature', slug: 'feature' }]]])
    const connectedArtistByRelease = new Map([['lr1', 'Connected Artist']])
    const { cards } = buildLocalAndGapCards({
      localReleases: [lr], mbById: new Map(), coArtistMap, connectedArtistByRelease, resolveImage,
    })
    expect(cards[0]!.coArtists).toEqual([{ name: 'Feature', slug: 'feature' }])
    expect(cards[0]!.connectedArtistName).toBe('Connected Artist')
  })

  it('preserves order: local cards first (in input order), then gap cards', () => {
    const mbCovered = mbRelease({ id: 'mb-covered' })
    const mbGap = mbRelease({ id: 'mb-gap' })
    const lr = localRelease({ id: 'lr1', releaseId: 'mb-covered' })
    const { cards } = buildLocalAndGapCards({
      localReleases: [lr],
      mbById: new Map([['mb-covered', mbCovered], ['mb-gap', mbGap]]),
      coArtistMap: new Map(), connectedArtistByRelease: new Map(), resolveImage,
    })
    expect(cards.map(c => c.id)).toEqual(['lr1', 'mb-gap'])
  })
})

describe('buildAppearsOnCards', () => {
  it('enriches an appears-on card with the fetched MB row when available', () => {
    const lr = localRelease({ id: 'lr1', releaseId: 'mb1', title: 'Local Title', year: 1999 })
    const mb = mbRelease({ id: 'mb1', title: 'MB Title', year: 2001 })
    const cards = buildAppearsOnCards({
      appearsOnLocal: [lr],
      appearsOnMbById: new Map([['mb1', mb]]),
      coArtistMap: new Map(), connectedArtistByRelease: new Map(), resolveImage,
    })
    expect(cards[0]).toMatchObject({ title: 'MB Title', year: 2001, isMusicBrainz: true, hasLocal: true })
  })

  it('falls back to the raw local title/year when the MB row is missing (e.g. retired on promote)', () => {
    const lr = localRelease({ id: 'lr1', releaseId: 'ghost', title: 'Local Title', year: 1999, matchStatus: 'UNMATCHED' })
    const cards = buildAppearsOnCards({
      appearsOnLocal: [lr],
      appearsOnMbById: new Map(),
      coArtistMap: new Map(), connectedArtistByRelease: new Map(), resolveImage,
    })
    expect(cards[0]).toMatchObject({ title: 'Local Title', year: 1999, isMusicBrainz: false, status: 'UNMATCHED', type: 'Album', typeSlug: 'album' })
  })
})

describe('sortReleaseCards', () => {
  const card = (id: string, year: number | null): ReleaseCard => ({
    id, title: id, year, type: 'Album', typeSlug: 'album', mbReleaseRowId: null, musicbrainzId: null,
    releaseGroupId: null, disambiguation: null, editionLabel: null, releaseDate: null, packaging: null,
    country: null, format: null, status: 'COMPLETE', image: null, imageUrl: null, trackCount: 0,
    totalPlayCount: 0, localTrackCount: 0, isMusicBrainz: false, hasLocal: true, localReleaseId: id,
    folderPath: null,
  })

  it('sorts an appended appears-on gap (e.g. 1971) after page-2 locals instead of leaving it stuck at the tail', () => {
    // Reproduces the reported bug: locals+gaps come pre-sorted year-ascending, appears-on cards are
    // appended after unsorted - a page-2 slice of the unsorted concatenation could show a 1971 release
    // right after a 2020 one.
    const localsAndGaps = [card('a', 1980), card('b', 2020)]
    const appearsOn = [card('c', 1971)]
    const sorted = sortReleaseCards([...localsAndGaps, ...appearsOn])
    expect(sorted.map(c => c.id)).toEqual(['c', 'a', 'b'])
  })

  it('sorts undated releases last', () => {
    const sorted = sortReleaseCards([card('dated', 1990), card('undated', null)])
    expect(sorted.map(c => c.id)).toEqual(['dated', 'undated'])
  })

  it('does not mutate the input array', () => {
    const input = [card('b', 2020), card('a', 1980)]
    sortReleaseCards(input)
    expect(input.map(c => c.id)).toEqual(['b', 'a'])
  })
})
