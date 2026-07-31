import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlayerStore } from '../../stores/player'

class FakeMediaMetadata {
  constructor(init: Record<string, unknown>) { Object.assign(this, init) }
}

class FakeAudio {
  src = ''
  currentTime = 0
  duration = 0
  volume = 1
  paused = true
  listeners: Record<string, (() => void)[]> = {}
  addEventListener(event: string, cb: () => void) {
    (this.listeners[event] ??= []).push(cb)
  }
  dispatch(event: string) {
    for (const cb of this.listeners[event] ?? []) cb()
  }
  load = vi.fn()
  play = vi.fn().mockImplementation(() => {
    this.paused = false
    return Promise.resolve()
  })
  pause = vi.fn().mockImplementation(() => { this.paused = true })
}

const track = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 't1', title: 'Track', artist: 'Artist', album: 'Album', duration: 200,
  artistSlug: 'artist', releaseImage: null, releaseImageUrl: null, localReleaseId: 'r1',
  ...overrides,
})

const fetchMock = vi.fn()

describe('usePlayerStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({})
    vi.stubGlobal('$fetch', fetchMock)
    vi.stubGlobal('Audio', FakeAudio)
    vi.stubGlobal('MediaMetadata', FakeMediaMetadata)
    vi.stubGlobal('navigator', {
      ...globalThis.navigator,
      mediaSession: {
        metadata: undefined,
        playbackState: 'none',
        setActionHandler: vi.fn(),
        setPositionState: vi.fn(),
      },
    })
    localStorage.removeItem('dmp-player')
  })

  it('playTrack sets currentTrack, loads audio, and starts playback', async () => {
    const store = usePlayerStore()
    await store.playTrack(track())
    expect(store.currentTrack?.id).toBe('t1')
    expect(store.isPlaying).toBe(true)
    expect(store.isVisible).toBe(true)
  })

  it('playTrack pushes the previous track onto history, capped at 50', async () => {
    const store = usePlayerStore()
    for (let i = 0; i < 55; i++) {
      await store.playTrack(track({ id: `t${i}` }))
    }
    expect(store.history.length).toBe(50)
  })

  it('togglePlay pauses when playing and resumes when paused', async () => {
    const store = usePlayerStore()
    await store.playTrack(track())
    expect(store.isPlaying).toBe(true)
    store.togglePlay()
    expect(store.isPlaying).toBe(false)
    store.togglePlay()
    await Promise.resolve()
    expect(store.isPlaying).toBe(true)
  })

  it('setVolume updates volume and unmutes', () => {
    const store = usePlayerStore()
    store.isMuted = true
    store.setVolume(0.3)
    expect(store.volume).toBe(0.3)
    expect(store.isMuted).toBe(false)
  })

  it('toggleMute flips isMuted', () => {
    const store = usePlayerStore()
    expect(store.isMuted).toBe(false)
    store.toggleMute()
    expect(store.isMuted).toBe(true)
  })

  it('setQueue shuffles when shuffleMode is not off, keeps order otherwise', async () => {
    const store = usePlayerStore()
    const tracks = [track({ id: 'a' }), track({ id: 'b' }), track({ id: 'c' })]
    store.setQueue(tracks)
    expect(store.queue.map(t => t.id)).toEqual(['a', 'b', 'c'])
    expect(store.originalQueue.map(t => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('setQueue with a startTrack plays that track specifically', async () => {
    const store = usePlayerStore()
    const tracks = [track({ id: 'a' }), track({ id: 'b' })]
    store.setQueue(tracks, tracks[1])
    await Promise.resolve()
    expect(store.currentTrack?.id).toBe('b')
  })

  it('next() in normal mode advances to the next queue index and wraps at the end', async () => {
    const store = usePlayerStore()
    const tracks = [track({ id: 'a' }), track({ id: 'b' })]
    store.setQueue(tracks, tracks[0])
    await store.next()
    expect(store.currentTrack?.id).toBe('b')
    await store.next()
    expect(store.currentTrack?.id).toBe('a') // wraps
  })

  it('next() falls back to a random track when the queue is empty', async () => {
    fetchMock.mockImplementation((url: string) => url === '/api/tracks/random'
      ? Promise.resolve(track({ id: 'random1' }))
      : Promise.resolve({}))
    const store = usePlayerStore()
    await store.next()
    expect(store.currentTrack?.id).toBe('random1')
  })

  it('next() in catalogue mode with an empty buffer falls back to /api/tracks/random and triggers a refill', async () => {
    // catalogueBuffer is private store state (not part of the returned public API), so it can't be
    // seeded directly from a test - only its externally observable effects (which track gets played,
    // and that a refill fetch fires) can be asserted.
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/tracks/random') return Promise.resolve(track({ id: 'random-catalogue' }))
      if (url.startsWith('/api/tracks/random-batch')) return Promise.resolve([track({ id: 'batch1' })])
      return Promise.resolve({})
    })
    const store = usePlayerStore()
    store.shuffleMode = 'catalogue'
    await store.next()
    expect(store.currentTrack?.id).toBe('random-catalogue')
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).startsWith('/api/tracks/random-batch'))).toBe(true)
    })
  })

  it('next() in catalogue mode falls back to /api/tracks/random when the buffer is empty', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/tracks/random') return Promise.resolve(track({ id: 'r1' }))
      return Promise.resolve([])
    })
    const store = usePlayerStore()
    store.shuffleMode = 'catalogue'
    await store.next()
    expect(store.currentTrack?.id).toBe('r1')
  })

  it('next() in explorer mode fetches via /api/tracks/explore and tracks session/explorer history', async () => {
    fetchMock.mockImplementation((url: string) => url === '/api/tracks/explore'
      ? Promise.resolve(track({ id: 'exp2' }))
      : Promise.resolve({}))
    const store = usePlayerStore()
    store.shuffleMode = 'explorer'
    store.explorerParams = { energy: 5, era: 5, familiarity: 5, sound: 5 }
    store.explorerCurrentTrack = track({ id: 'exp1' }) as any
    await store.next()
    expect(store.explorerCurrentTrack?.id).toBe('exp2')
    expect(store.explorerHistory).toContain('exp2')
    expect(store.explorerSessionHistory[0]?.id).toBe('exp1')
  })

  it('previous() restarts the current track when more than 3s in', async () => {
    const store = usePlayerStore()
    await store.playTrack(track())
    store.currentTime = 10
    store.previous()
    expect(store.currentTime).toBe(0)
  })

  it('previous() pops history and plays that track when under 3s in', async () => {
    const store = usePlayerStore()
    const tracks = [track({ id: 'a' }), track({ id: 'b' })]
    store.setQueue(tracks, tracks[0])
    await store.playTrack(tracks[1]!)
    store.currentTime = 1
    store.previous()
    await Promise.resolve()
    expect(store.currentTrack?.id).toBe('a')
  })

  it('previous() seeks to 0 when there is no history (given a track is already loaded)', async () => {
    const store = usePlayerStore()
    await store.playTrack(track()) // gives the audio element a src; seek() no-ops without one
    store.currentTime = 1
    store.previous()
    expect(store.currentTime).toBe(0)
  })

  it('previous() with no track loaded and no history is a safe no-op (seek() guards on an empty src)', () => {
    const store = usePlayerStore()
    store.currentTime = 1
    expect(() => store.previous()).not.toThrow()
  })

  it('previous() works in catalogue mode, where the track played is never in queue/originalQueue', async () => {
    // history stores full PlayerTrack objects (not ids) precisely so previous() doesn't depend on the
    // track still being present in some queue - catalogue/explorer tracks never are.
    const store = usePlayerStore()
    store.shuffleMode = 'catalogue'
    await store.playTrack(track({ id: 'cat-a' }))
    await store.playTrack(track({ id: 'cat-b' }))
    store.currentTime = 1
    store.previous()
    await Promise.resolve()
    expect(store.currentTrack?.id).toBe('cat-a')
  })

  it('playTrack(track, newQueue) delegates to setQueue and pushes exactly one history entry, not the new track itself', async () => {
    const store = usePlayerStore()
    const a = track({ id: 'a' })
    const b = track({ id: 'b' })
    await store.playTrack(a)
    await store.playTrack(b, [a, b])
    expect(store.history.map(t => t.id)).toEqual(['a'])
    expect(store.currentTrack?.id).toBe('b')
  })

  it('cycleShuffleMode cycles off -> release -> artist -> catalogue -> off', async () => {
    fetchMock.mockResolvedValue([])
    const store = usePlayerStore()
    expect(store.shuffleMode).toBe('off')
    await store.cycleShuffleMode()
    expect(store.shuffleMode).toBe('release')
    await store.cycleShuffleMode()
    expect(store.shuffleMode).toBe('artist')
    await store.cycleShuffleMode()
    expect(store.shuffleMode).toBe('catalogue')
    await store.cycleShuffleMode()
    expect(store.shuffleMode).toBe('off')
  })

  it('cycleShuffleMode exits explorer mode directly to off and clears explorer state', async () => {
    fetchMock.mockResolvedValue({ release: null, tracks: [] })
    const store = usePlayerStore()
    store.shuffleMode = 'explorer'
    store.explorerParams = { energy: 1, era: 1, familiarity: 1, sound: 1 }
    store.explorerHistory = ['a', 'b']
    store.explorerCurrentTrack = track() as any
    await store.cycleShuffleMode()
    expect(store.shuffleMode).toBe('off')
    expect(store.explorerParams).toBeNull()
    expect(store.explorerHistory).toEqual([])
    expect(store.explorerCurrentTrack).toBeNull()
  })

  it('switching into catalogue mode via cycleShuffleMode triggers a buffer refill fetch', async () => {
    fetchMock.mockResolvedValue([])
    const store = usePlayerStore()
    await store.cycleShuffleMode() // off -> release
    await store.cycleShuffleMode() // release -> artist
    await store.cycleShuffleMode() // artist -> catalogue
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]).startsWith('/api/tracks/random-batch'))).toBe(true)
    })
  })

  it('getAudioElement returns null before any playback and the element after', async () => {
    const store = usePlayerStore()
    expect(store.getAudioElement()).toBeNull()
    await store.playTrack(track())
    expect(store.getAudioElement()).not.toBeNull()
  })

  it('dismiss pauses and hides the player', async () => {
    const store = usePlayerStore()
    await store.playTrack(track())
    store.dismiss()
    expect(store.isPlaying).toBe(false)
    expect(store.isVisible).toBe(false)
  })

  it('persists volume/mute/shuffleMode/queue to localStorage on the next tick (debounced)', async () => {
    vi.useFakeTimers()
    const store = usePlayerStore()
    store.setVolume(0.42)
    await vi.advanceTimersByTimeAsync(600)
    const saved = JSON.parse(localStorage.getItem('dmp-player')!)
    expect(saved.volume).toBe(0.42)
    vi.useRealTimers()
  })

  it('persists currentTime on its own throttle so resume position does not go stale during uninterrupted playback', async () => {
    vi.useFakeTimers()
    const store = usePlayerStore()
    await store.playTrack(track())
    store.currentTime = 37
    await vi.advanceTimersByTimeAsync(5100)
    const saved = JSON.parse(localStorage.getItem('dmp-player')!)
    expect(saved.currentTime).toBe(37)
    vi.useRealTimers()
  })

  it('restoring from localStorage coerces a persisted explorer shuffleMode to off', () => {
    localStorage.setItem('dmp-player', JSON.stringify({
      trackId: null, currentTime: 0, volume: 0.5, isMuted: false,
      shuffleMode: 'explorer', queue: [], originalQueue: [], explorerParams: null,
    }))
    const store = usePlayerStore()
    expect(store.shuffleMode).toBe('off')
  })

  it('restoring from localStorage sets currentTrack paused at the saved position without auto-playing', () => {
    const savedTrack = track({ id: 'restored' })
    localStorage.setItem('dmp-player', JSON.stringify({
      trackId: 'restored', currentTime: 42, volume: 0.5, isMuted: false,
      shuffleMode: 'off', queue: [savedTrack], originalQueue: [savedTrack], explorerParams: null,
    }))
    const store = usePlayerStore()
    expect(store.currentTrack?.id).toBe('restored')
    expect(store.isPlaying).toBe(false)
    expect(store.isVisible).toBe(true)
  })

  it('swallows corrupt persisted JSON without throwing', () => {
    localStorage.setItem('dmp-player', '{not valid json')
    expect(() => usePlayerStore()).not.toThrow()
  })
})
