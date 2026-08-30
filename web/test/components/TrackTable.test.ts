import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TrackTable from '../../components/TrackTable.vue'
import { usePlayerStore } from '../../stores/player'
import type { TrackTableRow } from '../../components/TrackTable.vue'

const row = (id: string, overrides: Partial<TrackTableRow['track']> = {}): TrackTableRow => ({
  id: `pt-${id}`,
  track: {
    id,
    title: `Track ${id}`,
    trackNumber: 1,
    duration: 200,
    release: {
      id: 'r1',
      title: 'Album',
      image: null,
      imageUrl: null,
      artist: { id: 'a1', name: 'Artist', slug: 'artist' },
    },
    ...overrides,
  },
}) as TrackTableRow

describe('TrackTable.vue', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    usePlayerStore().currentTrack = null
  })

  it('renders a row per track with title, artist and duration', async () => {
    const wrapper = await mountSuspended(TrackTable, { props: { rows: [row('t1'), row('t2')] } })
    expect(wrapper.text()).toContain('Track t1')
    expect(wrapper.text()).toContain('Artist')
    expect(wrapper.text()).toContain('Album')
    expect(wrapper.text()).toContain('3:20')
  })

  it('shows the empty state when there are no rows', async () => {
    const wrapper = await mountSuspended(TrackTable, { props: { rows: [], emptyMessage: 'Nothing here' } })
    expect(wrapper.text()).toContain('Nothing here')
    expect(wrapper.find('table').exists()).toBe(false)
  })

  it('queues every row in order and starts at the clicked track', async () => {
    const rows = [row('t1'), row('t2'), row('t3')]
    const wrapper = await mountSuspended(TrackTable, { props: { rows } })
    const player = usePlayerStore()
    const setQueueSpy = vi.spyOn(player, 'setQueue').mockImplementation(() => {})

    await wrapper.findAll('tr')[1]!.trigger('click')

    expect(setQueueSpy).toHaveBeenCalledOnce()
    const [queue, start] = setQueueSpy.mock.calls[0]!
    expect(queue).toHaveLength(3)
    expect(queue.map(t => t.id)).toEqual(['t1', 't2', 't3'])
    expect(start).toMatchObject({ id: 't2' })
  })

  it('toggles playback instead of re-queueing when the clicked row is already current', async () => {
    const wrapper = await mountSuspended(TrackTable, { props: { rows: [row('t1')] } })
    const player = usePlayerStore()
    player.currentTrack = { id: 't1', title: 'Track t1', artist: 'Artist', album: 'Album', duration: 200, artistSlug: 'artist', releaseImage: null, releaseImageUrl: null, localReleaseId: 'r1' }
    const toggleSpy = vi.spyOn(player, 'togglePlay').mockImplementation(() => {})
    const setQueueSpy = vi.spyOn(player, 'setQueue').mockImplementation(() => {})

    await wrapper.get('tr').trigger('click')

    expect(toggleSpy).toHaveBeenCalledOnce()
    expect(setQueueSpy).not.toHaveBeenCalled()
  })

  it('renders the action slot per row and keeps it out of the row click', async () => {
    const wrapper = await mountSuspended(TrackTable, {
      props: { rows: [row('t1')] },
      slots: { action: '<button class="remove-btn">Remove</button>' },
    })
    expect(wrapper.find('.remove-btn').exists()).toBe(true)
  })
})
