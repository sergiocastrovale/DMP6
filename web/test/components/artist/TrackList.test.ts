import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import ArtistTrackList from '../../../components/artist/TrackList.vue'
import type { Track } from '../../../types/track'

vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(null))

const track = (overrides: Partial<Track> & { id: string }): Track => ({
  title: 'Untitled',
  artist: null,
  albumArtist: null,
  album: null,
  year: null,
  genre: null,
  duration: 180,
  trackNumber: 1,
  discNumber: null,
  playCount: 0,
  filePath: '',
  localReleaseId: null,
  ...overrides,
})

describe('TrackList.vue - disc subheaders (single-release track lists only)', () => {
  it('shows "Disc N" subheaders when a single release has tracks spanning more than one disc', async () => {
    const tracks = [
      track({ id: 't1', discNumber: 1, trackNumber: 1, title: 'Disc 1 Track' }),
      track({ id: 't2', discNumber: 2, trackNumber: 1, title: 'Disc 2 Track' }),
    ]
    const wrapper = await mountSuspended(ArtistTrackList, { props: { tracks } })
    expect(wrapper.text()).toContain('Disc 1')
    expect(wrapper.text()).toContain('Disc 2')
  })

  it('appends a disc title when one is known, and leaves untitled discs bare', async () => {
    const tracks = [
      track({ id: 't1', discNumber: 1, trackNumber: 1, title: 'Wreath' }),
      track({ id: 't2', discNumber: 2, trackNumber: 1, title: 'Windowpane' }),
    ]
    const wrapper = await mountSuspended(ArtistTrackList, { props: { tracks, discTitles: { 1: 'Deliverance' } } })
    const headers = wrapper.findAll('td[colspan]').map(td => td.text())
    expect(headers).toEqual(['Disc 1 — Deliverance', 'Disc 2'])
  })

  it('shows no subheader when every track is on the same disc', async () => {
    const tracks = [
      track({ id: 't1', discNumber: 1, trackNumber: 1 }),
      track({ id: 't2', discNumber: 1, trackNumber: 2 }),
    ]
    const wrapper = await mountSuspended(ArtistTrackList, { props: { tracks } })
    expect(wrapper.text()).not.toContain('Disc 1')
  })

  it('shows no subheader when discNumber is absent (treated as a single implicit disc)', async () => {
    const tracks = [
      track({ id: 't1', discNumber: null, trackNumber: 1 }),
      track({ id: 't2', discNumber: null, trackNumber: 2 }),
    ]
    const wrapper = await mountSuspended(ArtistTrackList, { props: { tracks } })
    expect(wrapper.text()).not.toContain('Disc')
  })

  it('never shows disc subheaders in the cross-release list view (release column present)', async () => {
    const tracks = [
      track({ id: 't1', discNumber: 1, trackNumber: 1 }),
      track({ id: 't2', discNumber: 2, trackNumber: 1 }),
    ]
    const wrapper = await mountSuspended(ArtistTrackList, {
      props: {
        tracks,
        columns: [
          { key: 'release', label: 'Release' },
          { key: 'trackNumber', label: '#' },
          { key: 'title', label: 'Title' },
        ],
      },
    })
    expect(wrapper.text()).not.toContain('Disc 1')
    expect(wrapper.text()).not.toContain('Disc 2')
  })
})

describe('TrackList.vue - favorite hearts come with the tracks', () => {
  const heart = (wrapper: Awaited<ReturnType<typeof mountSuspended>>, trackId: string) => {
    const idx = (wrapper.props('tracks') as Track[]).findIndex(t => t.id === trackId)
    return wrapper.findAll('button[aria-label="Toggle favorite"]')[idx]!
  }
  // ToggleFavorite paints an active heart amber.
  const isActive = (button: ReturnType<typeof heart>) => button.classes().includes('text-amber-400')

  it('renders a heart as active exactly for tracks flagged isFavorite, and never fetches /api/favorites', async () => {
    const fetchMock = vi.fn().mockResolvedValue(null)
    vi.stubGlobal('$fetch', fetchMock)
    const tracks = [
      track({ id: 'fav', isFavorite: true }),
      track({ id: 'plain', isFavorite: false }),
    ]
    const wrapper = await mountSuspended(ArtistTrackList, { props: { tracks } })

    expect(fetchMock).not.toHaveBeenCalledWith('/api/favorites')
    expect(isActive(heart(wrapper, 'fav'))).toBe(true)
    expect(isActive(heart(wrapper, 'plain'))).toBe(false)
  })

  it('reseeds when the list is replaced with fresh favorite state', async () => {
    const wrapper = await mountSuspended(ArtistTrackList, { props: { tracks: [track({ id: 'a', isFavorite: false })] } })
    expect(isActive(heart(wrapper, 'a'))).toBe(false)

    await wrapper.setProps({ tracks: [track({ id: 'a', isFavorite: true })] })

    expect(isActive(heart(wrapper, 'a'))).toBe(true)
  })
})
