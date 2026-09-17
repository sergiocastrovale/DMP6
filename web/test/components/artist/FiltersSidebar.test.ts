import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import FiltersSidebar from '../../../components/artist/FiltersSidebar.vue'
import { useArtistCatalogue } from '../../../composables/useArtistCatalogue'
import { statuses } from '../../../helpers/constants'
import type { UnifiedRelease } from '../../../types/release'

// FiltersSidebar renders via <Teleport to="body">, so its content lands outside the mounted
// wrapper's own DOM subtree - query document.body directly, same as browse/FiltersSidebar.test.ts.
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

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

const mountSidebar = async (releases: UnifiedRelease[]) => {
  const catalogue = useArtistCatalogue(ref(releases))
  wrapper = await mountSuspended(FiltersSidebar, {
    props: { modelValue: true, statusCounts: catalogue.statusCounts.value },
    global: { provide: { catalogue } },
  })
  return catalogue
}

describe('artist/FiltersSidebar.vue', () => {
  it('renders one status row per status that has a non-zero count', async () => {
    await mountSidebar([release({ id: '1', status: 'COMPLETE' }), release({ id: '2', status: 'MISSING' })])
    expect(document.body.textContent).toContain('Complete')
    expect(document.body.textContent).toContain('Missing')
    expect(document.body.textContent).not.toContain('Extra tracks')
  })

  it('toggles a status into the active set on click', async () => {
    const catalogue = await mountSidebar([release({ id: '1', status: 'COMPLETE' })])
    const button = document.body.querySelector('[aria-pressed]') as HTMLElement
    button.click()
    expect(catalogue.activeStatuses.value.has('COMPLETE')).toBe(true)
  })

  it('the legend shows every status description once toggled open', async () => {
    await mountSidebar([release({ id: '1', status: 'COMPLETE' })])
    const helpButton = document.body.querySelector('[aria-label="Toggle status legend"]') as HTMLElement
    helpButton.click()
    await wrapper!.vm.$nextTick()
    const complete = statuses.find(s => s.value === 'COMPLETE')!
    expect(document.body.textContent).toContain(complete.description)
  })

  it('toggles a release type into the filter set via checkbox', async () => {
    const catalogue = await mountSidebar([release({ id: '1', typeSlug: 'album' })])
    const checkbox = document.body.querySelector('input[type="checkbox"]') as HTMLInputElement
    checkbox.click()
    expect(catalogue.typeFilters.value.has('album')).toBe(true)
  })
})
