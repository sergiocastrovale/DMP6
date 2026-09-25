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
