import { mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import ReleaseInfoDialog from '../../components/ReleaseInfoDialog.vue'
import type { UnifiedRelease } from '../../types/release'

const release = (overrides: Partial<UnifiedRelease> = {}): UnifiedRelease => ({
  id: 'lr1', title: 'Heal the World Tour 92', year: 1994, type: 'Album', typeSlug: 'album',
  mbReleaseRowId: null, musicbrainzId: null, releaseGroupId: null, disambiguation: null,
  editionLabel: null, releaseDate: null, packaging: null, country: null, format: null,
  status: 'COMPLETE', image: null, imageUrl: null, trackCount: 0, totalPlayCount: 0,
  localTrackCount: 0, isMusicBrainz: true, hasLocal: false, localReleaseId: null, folderPath: null,
  ...overrides,
} as UnifiedRelease)

// Dialog.vue renders via <Teleport to="body">, so the content lands outside the wrapper's own subtree.
let wrapper: VueWrapper | undefined

const mount = async (r: UnifiedRelease) => {
  wrapper = await mountSuspended(ReleaseInfoDialog, {
    props: { modelValue: true, release: r, extra: null },
  })
  return document.body
}

describe('ReleaseInfoDialog.vue', () => {
  beforeEach(() => setActivePinia(createPinia()))

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
    document.body.innerHTML = ''
    document.body.style.overflow = ''
  })

  it('shows both ids and links the release to its own MusicBrainz page', async () => {
    const body = await mount(release({ musicbrainzId: 'rel-1', releaseGroupId: 'rg-1' }))

    expect(body.textContent!).toContain('MusicBrainz release ID')
    expect(body.textContent!).toContain('rel-1')
    expect(body.textContent!).toContain('MusicBrainz release group ID')
    expect(body.innerHTML).toContain('https://musicbrainz.org/release/rel-1')
    expect(body.innerHTML).toContain('https://musicbrainz.org/release-group/rg-1')
  })

  // A catalogue gap is built from the release group, whose MBID lands in both columns - printing it
  // as a release ID showed the same id twice and linked to a /release/ URL that 404s.
  it('shows a catalogue gap as a release group only, never as a release', async () => {
    const body = await mount(release({
      status: 'MISSING', hasLocal: false, musicbrainzId: 'rg-1', releaseGroupId: 'rg-1',
    }))

    expect(body.textContent!).not.toContain('MusicBrainz release ID')
    expect(body.textContent!).toContain('MusicBrainz release group ID')
    expect(body.innerHTML).toContain('https://musicbrainz.org/release-group/rg-1')
    expect(body.innerHTML).not.toContain('musicbrainz.org/release/rg-1')
  })

  // "Release ID" is the internal MusicBrainzRelease row id, not something the placeholder's real MB
  // release could ever be picked from - a gap has no chosen release at all. Showing it invited the
  // reading "this is the release", when it's an id for a row that stands in for a whole group.
  it('never shows the internal Release ID row for a gap - there is no chosen release to name', async () => {
    const body = await mount(release({ status: 'MISSING', hasLocal: false, id: 'mbrow1' }))

    expect(body.textContent!).not.toContain('Release ID')
    expect(body.textContent!).not.toContain('mbrow1')
  })

  it('still shows Release ID for a release actually backed by local files', async () => {
    const body = await mount(release({ hasLocal: true, localReleaseId: 'lr1', id: 'lr1' }))

    expect(body.textContent!).toContain('Release ID')
    expect(body.textContent!).toContain('lr1')
  })

  it('shows no MusicBrainz ids at all for an unmatched local release', async () => {
    const body = await mount(release({ status: 'UNMATCHED', localReleaseId: 'lr1', hasLocal: true }))

    expect(body.textContent!).not.toContain('MusicBrainz release ID')
    expect(body.textContent!).not.toContain('MusicBrainz release group ID')
  })
})
