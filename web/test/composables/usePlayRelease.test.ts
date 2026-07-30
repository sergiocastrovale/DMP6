import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlayRelease } from '../../composables/usePlayRelease'
import { usePlayerStore } from '../../stores/player'

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

describe('usePlayRelease', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
  })

  it('playRelease filters out missing tracks and queues the rest', async () => {
    fetchMock.mockResolvedValue({
      release: { title: 'Album', artistSlug: 'artist', image: 'a.jpg', imageUrl: null },
      tracks: [
        { id: '1', title: 'A', missing: false, localReleaseId: 'r1' },
        { id: '2', title: 'B', missing: true },
        { id: '3', title: 'C', missing: false, localReleaseId: 'r1' },
      ],
    })
    const player = usePlayerStore()
    const setQueueSpy = vi.spyOn(player, 'setQueue').mockImplementation(() => {})
    const { playRelease } = usePlayRelease()
    await playRelease('r1')
    expect(setQueueSpy).toHaveBeenCalledOnce()
    const [tracks, start] = setQueueSpy.mock.calls[0]!
    expect(tracks.map((t: any) => t.id)).toEqual(['1', '3'])
    expect(start).toEqual(tracks[0])
  })

  it('playRelease does nothing when every track is missing', async () => {
    fetchMock.mockResolvedValue({ release: {}, tracks: [{ id: '1', missing: true }] })
    const player = usePlayerStore()
    const setQueueSpy = vi.spyOn(player, 'setQueue').mockImplementation(() => {})
    const { playRelease } = usePlayRelease()
    await playRelease('r1')
    expect(setQueueSpy).not.toHaveBeenCalled()
  })

  it('playRelease swallows a fetch error', async () => {
    fetchMock.mockRejectedValue(new Error('network'))
    const { playRelease } = usePlayRelease()
    await expect(playRelease('r1')).resolves.toBeUndefined()
  })

  it('isCurrentRelease compares against the player\'s current track localReleaseId', () => {
    const player = usePlayerStore()
    player.currentTrack = { localReleaseId: 'r1' } as any
    const { isCurrentRelease } = usePlayRelease()
    expect(isCurrentRelease('r1')).toBe(true)
    expect(isCurrentRelease('r2')).toBe(false)
  })

  it('isReleasePlaying requires both current release AND isPlaying', () => {
    const player = usePlayerStore()
    player.currentTrack = { localReleaseId: 'r1' } as any
    player.isPlaying = false
    const { isReleasePlaying } = usePlayRelease()
    expect(isReleasePlaying('r1')).toBe(false)
    player.isPlaying = true
    expect(isReleasePlaying('r1')).toBe(true)
  })

  it('toggleOrPlay toggles playback for the current release instead of re-fetching', async () => {
    const player = usePlayerStore()
    player.currentTrack = { localReleaseId: 'r1' } as any
    const toggleSpy = vi.spyOn(player, 'togglePlay').mockImplementation(() => {})
    const { toggleOrPlay } = usePlayRelease()
    await toggleOrPlay('r1')
    expect(toggleSpy).toHaveBeenCalledOnce()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('toggleOrPlay fetches and plays a different release', async () => {
    fetchMock.mockResolvedValue({ release: {}, tracks: [{ id: '1', missing: false }] })
    const player = usePlayerStore()
    player.currentTrack = { localReleaseId: 'other' } as any
    const setQueueSpy = vi.spyOn(player, 'setQueue').mockImplementation(() => {})
    const { toggleOrPlay } = usePlayRelease()
    await toggleOrPlay('r1')
    expect(setQueueSpy).toHaveBeenCalledOnce()
  })
})
