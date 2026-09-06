import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import { useArtistCatalogue } from '../../composables/useArtistCatalogue'
import type { UnifiedRelease } from '../../types/release'

const release = (overrides: Partial<UnifiedRelease> & { id: string }): UnifiedRelease => ({
  title: 'Untitled',
  year: 2000,
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
  status: 'COMPLETE',
  image: null,
  imageUrl: null,
  trackCount: 0,
  totalPlayCount: 0,
  localTrackCount: 0,
  isMusicBrainz: true,
  hasLocal: true,
  localReleaseId: null,
  folderPath: null,
  ...overrides,
} as UnifiedRelease)

describe('useArtistCatalogue', () => {
  it('visibleReleases hides MISSING releases when showMissing is false', () => {
    const releases = ref([release({ id: '1', status: 'MISSING' }), release({ id: '2', status: 'COMPLETE' })])
    const cat = useArtistCatalogue(releases)
    cat.showMissing.value = false
    expect(cat.visibleReleases.value.map(r => r.id)).toEqual(['2'])
  })

  it('visibleReleases hides connected-artist releases when showLinked is false', () => {
    const releases = ref([release({ id: '1', connectedArtistName: 'Other' }), release({ id: '2' })])
    const cat = useArtistCatalogue(releases)
    cat.showLinked.value = false
    expect(cat.visibleReleases.value.map(r => r.id)).toEqual(['2'])
  })

  it('hasLinkedReleases reflects presence of any connectedArtistName', () => {
    const releases = ref([release({ id: '1', connectedArtistName: 'Other' })])
    expect(useArtistCatalogue(releases).hasLinkedReleases.value).toBe(true)
    expect(useArtistCatalogue(ref([release({ id: '1' })])).hasLinkedReleases.value).toBe(false)
  })

  it('filteredReleases filters by active status set', () => {
    const releases = ref([release({ id: '1', status: 'COMPLETE' }), release({ id: '2', status: 'MISSING' })])
    const cat = useArtistCatalogue(releases)
    cat.activeStatuses.value = new Set(['COMPLETE'])
    expect(cat.filteredReleases.value.map(r => r.id)).toEqual(['1'])
  })

  it('filteredReleases filters by type, including the "other" bucket', () => {
    const releases = ref([
      release({ id: '1', typeSlug: 'album' }),
      release({ id: '2', typeSlug: 'single' }),
      release({ id: '3', typeSlug: 'compilation' }),
    ])
    const cat = useArtistCatalogue(releases)
    cat.typeFilter.value = 'other'
    expect(cat.filteredReleases.value.map(r => r.id)).toEqual(['3'])
  })

  it('filteredReleases filters by search query across title/disambiguation/editionLabel', () => {
    const releases = ref([
      release({ id: '1', title: 'Geogaddi' }),
      release({ id: '2', title: 'Music Has the Right to Children', disambiguation: 'deluxe' }),
    ])
    const cat = useArtistCatalogue(releases)
    cat.searchQuery.value = 'deluxe'
    expect(cat.filteredReleases.value.map(r => r.id)).toEqual(['2'])
  })

  it('groups: null releaseGroupId puts each release in its own solo group', () => {
    const releases = ref([release({ id: '1', releaseGroupId: null }), release({ id: '2', releaseGroupId: null })])
    const cat = useArtistCatalogue(releases)
    expect(cat.groups.value).toHaveLength(2)
    expect(cat.groups.value.map(g => g.key)).toEqual(['solo:1', 'solo:2'])
  })

  it('groups: shared releaseGroupId collapses editions into one group', () => {
    const releases = ref([
      release({ id: '1', releaseGroupId: 'grp-a', year: 2000 }),
      release({ id: '2', releaseGroupId: 'grp-a', year: 2000 }),
    ])
    const cat = useArtistCatalogue(releases)
    expect(cat.groups.value).toHaveLength(1)
    expect(cat.groups.value[0]!.releases).toHaveLength(2)
  })

  it('groups: dateKey falls back to 9999-99-99 for undated releases, sorting them last', () => {
    const releases = ref([
      release({ id: 'undated', releaseGroupId: 'g', year: null, releaseDate: null }),
      release({ id: 'dated', releaseGroupId: 'g', year: 1990, releaseDate: null }),
    ])
    const cat = useArtistCatalogue(releases)
    const group = cat.groups.value[0]!
    expect(group.releases.map(r => r.id)).toEqual(['dated', 'undated'])
    expect(group.primary.id).toBe('dated')
  })

  it('groups: a box-edition virtual card joins the album\'s edition group via its borrowed releaseGroupId', () => {
    // buildBoxEditionCards (server/utils/releaseAggregation.ts) gives a box disc the ALBUM's own
    // releaseGroupId, not the box's - so the grouper needs no box-specific logic at all to place it
    // alongside the album's real editions (docs/box_sets.md goal 2).
    const releases = ref([
      release({ id: 'album-1', releaseGroupId: 'rg-ringring', year: 1973 }),
      release({
        id: 'box1:medium:1', releaseGroupId: 'rg-ringring', year: 2008,
        boxParent: { releaseId: 'box1', title: 'The Albums', mediumPosition: 1, mediumTitle: 'Ring Ring' },
      }),
    ])
    const cat = useArtistCatalogue(releases)
    expect(cat.groups.value).toHaveLength(1)
    expect(cat.groups.value[0]!.releases.map(r => r.id)).toEqual(['album-1', 'box1:medium:1'])
  })

  it('groups: a box set\'s own card is a solo group carrying discCount for the discs pill', () => {
    const releases = ref([release({ id: 'box1', releaseGroupId: 'rg-box', discCount: 9 })])
    const cat = useArtistCatalogue(releases)
    expect(cat.groups.value[0]!.primary.discCount).toBe(9)
  })

  it('groups: totals sum trackCount/localTrackCount/totalPlayCount across the group', () => {
    const releases = ref([
      release({ id: '1', releaseGroupId: 'g', trackCount: 10, localTrackCount: 8, totalPlayCount: 5 }),
      release({ id: '2', releaseGroupId: 'g', trackCount: 12, localTrackCount: 12, totalPlayCount: 3 }),
    ])
    const cat = useArtistCatalogue(releases)
    const group = cat.groups.value[0]!
    expect(group.totalTracks).toBe(22)
    expect(group.totalLocalTracks).toBe(20)
    expect(group.totalPlayCount).toBe(8)
  })

  it('totalCounts/visibleCounts count by typeSlug', () => {
    const releases = ref([
      release({ id: '1', typeSlug: 'album' }),
      release({ id: '2', typeSlug: 'ep' }),
      release({ id: '3', typeSlug: 'single' }),
      release({ id: '4', typeSlug: 'compilation' }),
    ])
    const cat = useArtistCatalogue(releases)
    expect(cat.totalCounts.value).toEqual({ total: 3, albums: 1, eps: 1, singles: 1 })
  })

  it('statusCounts counts within the currently visible set', () => {
    const releases = ref([
      release({ id: '1', status: 'COMPLETE' }),
      release({ id: '2', status: 'COMPLETE' }),
      release({ id: '3', status: 'MISSING' }),
    ])
    const cat = useArtistCatalogue(releases)
    expect(cat.statusCounts.value).toEqual({ COMPLETE: 2, MISSING: 1 })
  })
})
