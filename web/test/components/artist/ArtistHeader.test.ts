import { mountSuspended } from '@nuxt/test-utils/runtime'
import { computed } from 'vue'
import { describe, expect, it } from 'vitest'
import ArtistHeader from '../../../components/artist/ArtistHeader.vue'
import type { Artist } from '../../../types/artist'

const artist: Artist = {
  id: 'a1', name: 'Boards of Canada', slug: 'boards-of-canada', image: null, imageUrl: null,
  averageMatchScore: null, totalPlayCount: 0, totalTracks: 0, musicbrainzId: null,
  totalFileSize: 0, lastSyncedAt: null, genres: [], urls: [],
}

const catalogueStub = {
  visibleCounts: computed(() => ({ total: 0, albums: 0, eps: 0, singles: 0 })),
  totalCounts: computed(() => ({ total: 0, albums: 0, eps: 0, singles: 0 })),
}

const mountHeader = async (props: Partial<InstanceType<typeof ArtistHeader>['$props']> = {}) =>
  mountSuspended(ArtistHeader, {
    props: { artist, ...props },
    global: {
      provide: { catalogue: catalogueStub },
      stubs: { DialogGenres: true, DownloadProgress: true },
    },
  })

describe('artist/ArtistHeader.vue', () => {
  it('renders a Shuffle button beside Play all', async () => {
    const wrapper = await mountHeader()
    expect(wrapper.text()).toContain('Play all')
    expect(wrapper.text()).toContain('Shuffle')
  })

  it('emits shuffleAll when the Shuffle button is clicked', async () => {
    const wrapper = await mountHeader()
    const buttons = wrapper.findAll('button')
    const shuffleButton = buttons.find(b => b.text().includes('Shuffle'))!
    await shuffleButton.trigger('click')
    expect(wrapper.emitted('shuffleAll')).toHaveLength(1)
  })

  it('emits playAll when the Play all button is clicked', async () => {
    const wrapper = await mountHeader()
    const buttons = wrapper.findAll('button')
    const playButton = buttons.find(b => b.text().includes('Play all'))!
    await playButton.trigger('click')
    expect(wrapper.emitted('playAll')).toHaveLength(1)
  })

  it('shows the artist image, falling back to an initial when there is none', async () => {
    // `imageUrl` only resolves when S3 storage is on; the local path comes from `image`.
    const withArt = await mountHeader({ artist: { ...artist, image: 'boards.jpg' } } as any)
    expect(withArt.get('img').attributes('src')).toBe('/img/artists/boards.jpg')

    const withoutArt = await mountHeader()
    expect(withoutArt.find('img').exists()).toBe(false)
    expect(withoutArt.text()).toContain('B') // Boards of Canada
  })

  it('keeps one primary action: Play all is filled, Shuffle is secondary', async () => {
    const wrapper = await mountHeader()
    const classesOf = (label: string) =>
      wrapper.findAll('button').find(b => b.text().includes(label))!.classes().join(' ')
    expect(classesOf('Play all')).toContain('bg-amber-400')
    expect(classesOf('Shuffle')).not.toContain('bg-amber-400')
  })

  it('disables the Shuffle button when shuffleDisabled is true', async () => {
    const wrapper = await mountHeader({ shuffleDisabled: true })
    const buttons = wrapper.findAll('button')
    const shuffleButton = buttons.find(b => b.text().includes('Shuffle'))!
    expect(shuffleButton.attributes('disabled')).toBeDefined()
  })
})
