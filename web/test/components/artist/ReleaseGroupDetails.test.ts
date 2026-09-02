import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import ArtistReleaseGroupDetails from '../../../components/artist/ReleaseGroupDetails.vue'
import type { UnifiedRelease } from '../../../types/release'

vi.mock('~/stores/downloads', () => ({
  useDownloadsStore: () => ({ downloadsEnabled: false }),
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

const mountRelease = (overrides: Partial<UnifiedRelease>) =>
  mountSuspended(ArtistReleaseGroupDetails, {
    props: {
      release: { ...baseRelease, ...overrides },
      expanded: false,
      isFavorite: false,
      slug: 'bing-crosby',
    },
  })

describe('artist/ReleaseGroupDetails.vue - owned-bundle sub-release', () => {
  it('shows the "owned as part of" pill and emits goToBundle on click, using bundleParentReleaseId', async () => {
    const wrapper = await mountRelease({
      bundleParentReleaseId: 'parent-lr',
      statusReason: 'Owned as part of "Bing With a Beat"',
    })
    const pill = wrapper.findAll('button').find(b => b.attributes('title') === 'Owned as part of "Bing With a Beat"')
    expect(pill).toBeTruthy()
    await pill!.trigger('click')
    expect(wrapper.emitted('goToBundle')).toHaveLength(1)
  })

  it('does not render the pill for a normal local release (no bundleParentReleaseId)', async () => {
    const wrapper = await mountRelease({ localReleaseId: 'own-lr', hasLocal: true })
    expect(wrapper.text()).not.toContain('Owned as part of')
  })

  it('shows Favorite (labelled as favoriting the bundle) when only bundleParentReleaseId is set', async () => {
    const wrapper = await mountRelease({ bundleParentReleaseId: 'parent-lr' })
    expect(wrapper.find('[title="Favorite the release this is bundled in"]').exists()).toBe(true)
  })

  it('does not show Refresh for a bundle sub-release', async () => {
    const wrapper = await mountRelease({ bundleParentReleaseId: 'parent-lr' })
    expect(wrapper.find('[title="Refresh this release"]').exists()).toBe(false)
  })

  it('is expandable/playable once localTrackCount is real, even with no localReleaseId', async () => {
    const wrapper = await mountRelease({ bundleParentReleaseId: 'parent-lr', localTrackCount: 2 })
    await wrapper.find('[class*="group/edition"]').trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })

  it('is not expandable when there is no bundle link and no local tracks', async () => {
    const wrapper = await mountRelease({})
    await wrapper.find('[class*="group/edition"]').trigger('click')
    expect(wrapper.emitted('toggle')).toBeUndefined()
  })
})
