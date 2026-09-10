import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import ArtistReleaseGroupDetails from '../../../components/artist/ReleaseGroupDetails.vue'
import type { UnifiedRelease } from '../../../types/release'

vi.mock('~/stores/downloads', () => ({
  useDownloadsStore: () => ({ downloadsEnabled: false, acquireBlockReasons: [], mergeBlockReasons: [] }),
}))
vi.mock('~/stores/terminal', () => ({
  useTerminalStore: () => ({ isRunning: false }),
}))

mockNuxtImport('useImageUrl', () => () => ({ releaseImage: () => null }))
mockNuxtImport('usePlayRelease', () => () => ({
  isCurrentRelease: () => false,
  isReleasePlaying: () => false,
}))
mockNuxtImport('useReleaseDownloadState', () => () => ({
  isSearching: false,
  isDownloading: false,
  isEnriching: false,
  isAwaitingMerge: false,
  downloadFailed: false,
  isAbandoned: false,
  verifyDownload: () => {},
}))
mockNuxtImport('useDownloadQueueActions', () => () => ({
  merge: () => Promise.resolve(),
  busyIds: new Set<string>(),
}))

const baseRelease: UnifiedRelease = {
  id: 'mb-vol-ii',
  title: 'Bing With a Beat, Vol. II',
  year: 1957,
  type: 'Album',
  typeSlug: 'album',
  mbReleaseRowId: 'mb-vol-ii',
  musicbrainzId: 'mbid-vol-ii',
  releaseGroupId: 'rg-vol-ii',
  disambiguation: null,
  editionLabel: null,
  releaseDate: null,
  packaging: null,
  country: null,
  format: null,
  status: 'COMPLETE',
  image: null,
  imageUrl: null,
  trackCount: 2,
  totalPlayCount: 0,
  localTrackCount: 0,
  isMusicBrainz: true,
  hasLocal: false,
  localReleaseId: null,
  bundleParentReleaseId: null,
  folderPath: null,
  statusReason: null,
}

const mountRelease = (overrides: Partial<UnifiedRelease>, extraProps: Record<string, unknown> = {}) =>
  mountSuspended(ArtistReleaseGroupDetails, {
    props: {
      release: { ...baseRelease, ...overrides },
      expanded: false,
      isFavorite: false,
      slug: 'bing-crosby',
      ...extraProps,
    },
  })

describe('artist/ReleaseGroupDetails.vue - gap noting containment', () => {
  const note = 'Recordings inside "Bing With a Beat"'

  it('shows the containment note and emits goToBundle on click when the container resolved', async () => {
    const wrapper = await mountRelease({ status: 'MISSING', bundleParentReleaseId: 'parent-lr', statusReason: note })
    const pill = wrapper.findAll('button').find(b => b.text().includes(note))
    expect(pill).toBeTruthy()
    await pill!.trigger('click')
    expect(wrapper.emitted('goToBundle')).toHaveLength(1)
  })

  it('still shows the note, unclickable, when the container is not on this page', async () => {
    const wrapper = await mountRelease({ status: 'MISSING', statusReason: note })
    expect(wrapper.text()).toContain(note)
    expect(wrapper.findAll('button').some(b => b.text().includes(note))).toBe(false)
  })

  it('renders the title greyed as a gap, not as an owned release', async () => {
    const contained = await mountRelease({ status: 'MISSING', bundleParentReleaseId: 'parent-lr', statusReason: note })
    const owned = await mountRelease({ status: 'COMPLETE', localReleaseId: 'own-lr', hasLocal: true })
    const titleClass = (w: typeof contained) => w.findAll('span').find(el => el.text() === 'Bing With a Beat, Vol. II')!.classes().join(' ')
    expect(titleClass(contained)).toContain('text-stone-100/55')
    expect(titleClass(owned)).not.toContain('text-stone-100/55')
  })

  it('renders no note for a release whose statusReason is not a containment note', async () => {
    const wrapper = await mountRelease({ status: 'MISSING', statusReason: 'incomplete: 3/9 tracks' })
    expect(wrapper.text()).not.toContain('Recordings inside')
  })

  it('does not render a note for a normal local release', async () => {
    const wrapper = await mountRelease({ localReleaseId: 'own-lr', hasLocal: true })
    expect(wrapper.text()).not.toContain('Recordings inside')
  })

  it('does not show Refresh for a gap that only names a container', async () => {
    const wrapper = await mountRelease({ status: 'MISSING', bundleParentReleaseId: 'parent-lr', statusReason: note })
    expect(wrapper.find('[title="Refresh this release"]').exists()).toBe(false)
  })

  it('is not expandable: the container holds the files, this release is still a gap', async () => {
    const wrapper = await mountRelease({ status: 'MISSING', bundleParentReleaseId: 'parent-lr', statusReason: note })
    await wrapper.find('[class*="group/edition"]').trigger('click')
    expect(wrapper.emitted('toggle')).toBeUndefined()
  })
})

describe('artist/ReleaseGroupDetails.vue - box sets (docs/sync_decisions.md)', () => {
  it('renders the subtitle and disc-label slots for a dissolved box disc', async () => {
    const wrapper = await mountRelease({}, { subtitle: 'The Albums', discLabel: 'disc 1 of 9' })
    expect(wrapper.text()).toContain('The Albums')
    expect(wrapper.text()).toContain('disc 1 of 9')
    expect(wrapper.text()).not.toContain('Box Set')
  })

  it('renders the "Box Set" marker pill for a rarities/no-equivalent disc', async () => {
    const wrapper = await mountRelease({}, { isBoxSet: true })
    expect(wrapper.text()).toContain('Box Set')
  })

  it('renders none of the box-set slots for an ordinary release', async () => {
    const wrapper = await mountRelease({})
    expect(wrapper.text()).not.toContain('Box Set')
  })

  it('shows an "Also part of" chip when the release group is reprinted by a box set (§7)', async () => {
    const wrapper = await mountRelease({ alsoPartOf: [{ title: 'The Legacy Edition Box', year: 2008 }] })
    expect(wrapper.text()).toContain('Also part of: The Legacy Edition Box (2008)')
  })

  it('shows no "Also part of" chip when alsoPartOf is empty/absent', async () => {
    const wrapper = await mountRelease({})
    expect(wrapper.text()).not.toContain('Also part of')
  })

  it('shows "N discs" inline next to type/year/tracks for a multi-disc release', async () => {
    const wrapper = await mountRelease({ discCount: 9 })
    expect(wrapper.text()).toContain('9 discs')
  })

  it('shows no disc count for a single-disc release', async () => {
    const wrapper = await mountRelease({ discCount: 1 })
    expect(wrapper.text()).not.toContain('discs')
  })
})
