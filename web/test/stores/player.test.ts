import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlayerStore } from '../../stores/player'
import { EXPLORER_SESSION_HISTORY_CAP } from '../../helpers/playerLogic'

// The store's localStorage restore is deferred (useAfterHydration, see stores/player.ts) because
// Nuxt's Pinia SSR hydration overwrites every ref back to the server-rendered value immediately
// after setup() returns. Created inside a component it runs on mount, which this host reproduces;
// created outside one (plugins/presence.client.ts) it runs on the next tick - covered separately
// below, since that is the case a bare onMounted used to miss.
//
// mountSuspended mounts into @nuxt/test-utils' own persistent app/Pinia, not into whatever
// setActivePinia(createPinia()) made active in beforeEach - so without passing this test's pinia
// in explicitly, every call in the file after the first would resolve the SAME cached store
// (setup(), and its one-time onMounted registration, only ever runs once) instead of a fresh one,
// and every localStorage seeded by a later test would silently never be read.
const usePlayerStoreMounted = async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  let store!: ReturnType<typeof usePlayerStore>
  await mountSuspended(defineComponent({
    setup() {
      store = usePlayerStore()
      return () => null
    },
  }), { global: { plugins: [pinia] } })
  return store
}

// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- stubs the real MediaMetadata constructor for vi.stubGlobal
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
    for (const cb of this.listeners[event] ?? []) {cb()}
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
    // Every playTrack() opens a PlayEvent (composables/usePlayEventTracker.ts) - give it an id so
    // tests that drive timeupdate past the counted threshold can assert the resulting PATCH.
    fetchMock.mockImplementation((url: string) => url === '/api/play-events'
      ? Promise.resolve({ id: 'ev1' })
      : Promise.resolve({}))
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

  describe('unplayable tracks', () => {
    const errorOn = (store: ReturnType<typeof usePlayerStore>, code = 4) => {
      const el = store.getAudioElement() as unknown as FakeAudio & { error?: { code: number } }
      el.error = { code }
      el.dispatch('error')
    }

    it('skips to the next queue track, finishes the play event as a skip and toasts', async () => {
      const store = usePlayerStore()
      const tracks = [track({ id: 'a' }), track({ id: 'b' }), track({ id: 'c' })]
      store.setQueue(tracks, tracks[0])
      await vi.waitFor(() => expect(store.currentTrack?.id).toBe('a'))
      await vi.waitFor(() => expect(fetchMock.mock.calls.some(c => String(c[0]) === '/api/play-events')).toBe(true))

      errorOn(store)

      await vi.waitFor(() => expect(store.currentTrack?.id).toBe('b'))
      const finish = fetchMock.mock.calls.find(c => String(c[0]) === '/api/play-events/ev1' && (c[1] as any)?.body?.ended === true)
      expect((finish?.[1] as any).body.skipped).toBe(true)
      expect(useToastStore().toasts.map(t => t.message)).toContain('Skipped unplayable track')
    })

    it('gives up after three unplayable tracks in a row', async () => {
      const store = usePlayerStore()
      const tracks = ['a', 'b', 'c', 'd', 'e'].map(id => track({ id }))
      store.setQueue(tracks, tracks[0])
      await vi.waitFor(() => expect(store.currentTrack?.id).toBe('a'))

      errorOn(store)
      await vi.waitFor(() => expect(store.currentTrack?.id).toBe('b'))
      errorOn(store)
      await vi.waitFor(() => expect(store.currentTrack?.id).toBe('c'))
      errorOn(store)

      await Promise.resolve()
      expect(store.currentTrack?.id).toBe('c')
      expect(useToastStore().toasts.map(t => t.message)).toContain('Stopped after 3 unplayable tracks in a row')
    })

    it('real playback progress resets the streak', async () => {
      const store = usePlayerStore()
      const tracks = ['a', 'b', 'c', 'd', 'e'].map(id => track({ id }))
      store.setQueue(tracks, tracks[0])
      await vi.waitFor(() => expect(store.currentTrack?.id).toBe('a'))
      const el = store.getAudioElement() as unknown as FakeAudio

      errorOn(store)
      await vi.waitFor(() => expect(store.currentTrack?.id).toBe('b'))
      errorOn(store)
      await vi.waitFor(() => expect(store.currentTrack?.id).toBe('c'))
      el.currentTime = 1
      el.dispatch('timeupdate')
      errorOn(store)
      await vi.waitFor(() => expect(store.currentTrack?.id).toBe('d'))
    })

    it('ignores an aborted load (we swapped the source ourselves)', async () => {
      const store = usePlayerStore()
      const tracks = [track({ id: 'a' }), track({ id: 'b' })]
      store.setQueue(tracks, tracks[0])
      await vi.waitFor(() => expect(store.currentTrack?.id).toBe('a'))

      errorOn(store, 1)

      await Promise.resolve()
      expect(store.currentTrack?.id).toBe('a')
      expect(useToastStore().toasts).toHaveLength(0)
    })
  })

  it('playTrack sets currentTrack, loads audio, and starts playback', async () => {
    const store = usePlayerStore()
    await store.playTrack(track())
    expect(store.currentTrack?.id).toBe('t1')
    expect(store.isPlaying).toBe(true)
    expect(store.isVisible).toBe(true)
  })

  it('does not count a play immediately at playback start - only once the scrobble threshold is crossed', async () => {
    const store = usePlayerStore()
    await store.playTrack(track())
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]) === '/api/play-events')).toBe(true)
    })

    const audioEl = store.getAudioElement() as unknown as FakeAudio
    audioEl.duration = 100
    audioEl.dispatch('loadedmetadata') // populates store.duration
    const countedCalls = () => fetchMock.mock.calls.filter(c =>
      String(c[0]) === '/api/play-events/ev1' && (c[1] as any)?.body?.counted === true)

    audioEl.currentTime = 0.25 // real-time tick, well under the 50s (50%) threshold
    audioEl.dispatch('timeupdate')
    expect(countedCalls()).toHaveLength(0)

    // Gradual real-time ticks (0.25s deltas) crossing the threshold - a single big jump would be
    // treated as a seek and ignored (composables/usePlayEventTracker.ts).
    for (let t = 0.5; t <= 50.25; t += 0.25) {
      audioEl.currentTime = t
      audioEl.dispatch('timeupdate')
    }
    expect(countedCalls()).toHaveLength(1)
  })

  it('counts a play only once per track even with repeated timeupdate ticks past the threshold', async () => {
    const store = usePlayerStore()
    await store.playTrack(track())
    await vi.waitFor(() => {
      expect(fetchMock.mock.calls.some(c => String(c[0]) === '/api/play-events')).toBe(true)
    })
    const audioEl = store.getAudioElement() as unknown as FakeAudio
    audioEl.duration = 100
    audioEl.dispatch('loadedmetadata')

    for (let t = 0.25; t <= 52; t += 0.25) {
      audioEl.currentTime = t
      audioEl.dispatch('timeupdate')
    }
    const countedCalls = fetchMock.mock.calls.filter(c =>
      String(c[0]) === '/api/play-events/ev1' && (c[1] as any)?.body?.counted === true)
    expect(countedCalls).toHaveLength(1)
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
      if (url === '/api/tracks/random') {return Promise.resolve(track({ id: 'random-catalogue' }))}
      if (url.startsWith('/api/tracks/random-batch')) {return Promise.resolve([track({ id: 'batch1' })])}
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
      if (url === '/api/tracks/random') {return Promise.resolve(track({ id: 'r1' }))}
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

  it('explorer session history keeps only the newest EXPLORER_SESSION_HISTORY_CAP entries', async () => {
    let n = 0
    fetchMock.mockImplementation((url: string) => url === '/api/tracks/explore'
      ? Promise.resolve(track({ id: `exp${++n}` }))
      : Promise.resolve({}))
    const store = usePlayerStore()
    store.shuffleMode = 'explorer'
    store.explorerParams = { energy: 5, era: 5, familiarity: 5, sound: 5 }
    for (let i = 0; i < 60; i++) {
      await store.next()
    }
    expect(store.explorerSessionHistory).toHaveLength(EXPLORER_SESSION_HISTORY_CAP)
    expect(store.explorerSessionHistory[0]?.id).toBe('exp59')
    expect(store.explorerSessionHistory.at(-1)?.id).toBe('exp10')
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

  it('artist shuffle loads a server-sampled queue from /shuffle and keeps its cover art', async () => {
    const sampled = [
      track({ id: 's1', artistSlug: 'someone', releaseImage: 'cover.jpg', localReleaseId: 'r9' }),
      track({ id: 's2', artistSlug: 'someone', releaseImage: 'cover.jpg', localReleaseId: 'r9' }),
    ]
    fetchMock.mockImplementation(async (url: string) => (url === '/api/artists/someone/shuffle' ? sampled : []))
    const store = usePlayerStore()
    await store.playTrack(track({ id: 'now', artistSlug: 'someone', localReleaseId: 'r1' }))
    store.shuffleMode = 'release'

    await store.cycleShuffleMode() // release -> artist

    expect(store.shuffleMode).toBe('artist')
    expect(fetchMock).toHaveBeenCalledWith('/api/artists/someone/shuffle')
    expect(store.originalQueue.map(t => t.id)).toEqual(['s1', 's2'])
    expect(store.originalQueue[0]!.releaseImage).toBe('cover.jpg')
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

  it('persists a replaced queue and explorer params without a deep watch', async () => {
    vi.useFakeTimers()
    const store = usePlayerStore()
    const tracks = ['a', 'b', 'c'].map(id => track({ id }))
    store.setQueue(tracks, tracks[0])
    await vi.advanceTimersByTimeAsync(600)
    expect(JSON.parse(localStorage.getItem('dmp-player')!).queue.map((t: { id: string }) => t.id)).toEqual(['a', 'b', 'c'])
    await store.cycleShuffleMode()
    await vi.advanceTimersByTimeAsync(600)
    expect(JSON.parse(localStorage.getItem('dmp-player')!).shuffleMode).not.toBe('off')
    vi.useRealTimers()
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

  it('restoring from localStorage coerces a persisted explorer shuffleMode to off', async () => {
    // Volume is set to something other than the ref's own default (0.75) so this test fails
    // honestly if restoration silently doesn't run, instead of passing by coincidence the way it
    // did when shuffleMode's restored value happened to match its unrestored default.
    localStorage.setItem('dmp-player', JSON.stringify({
      trackId: null, currentTime: 0, volume: 0.4, isMuted: false,
      shuffleMode: 'explorer', queue: [], originalQueue: [], explorerParams: null,
    }))
    const store = await usePlayerStoreMounted()
    expect(store.volume).toBe(0.4)
    expect(store.shuffleMode).toBe('off')
  })

  it('restoring from localStorage sets currentTrack paused at the saved position without auto-playing', async () => {
    const savedTrack = track({ id: 'restored' })
    localStorage.setItem('dmp-player', JSON.stringify({
      trackId: 'restored', currentTime: 42, volume: 0.5, isMuted: false,
      shuffleMode: 'off', queue: [savedTrack], originalQueue: [savedTrack], explorerParams: null,
    }))
    const store = await usePlayerStoreMounted()
    expect(store.currentTrack?.id).toBe('restored')
    expect(store.isPlaying).toBe(false)
    expect(store.isVisible).toBe(true)
  })

  it('restores when the store is first created outside any component, as a plugin does', async () => {
    const savedTrack = track({ id: 'restored-from-plugin' })
    localStorage.setItem('dmp-player', JSON.stringify({
      trackId: 'restored-from-plugin', currentTime: 0, volume: 0.3, isMuted: false,
      shuffleMode: 'off', queue: [savedTrack], originalQueue: [savedTrack], explorerParams: null,
    }))
    setActivePinia(createPinia())
    const store = usePlayerStore()
    await nextTick()
    expect(store.volume).toBe(0.3)
    expect(store.currentTrack?.id).toBe('restored-from-plugin')
    expect(store.isVisible).toBe(true)
  })

  it('swallows corrupt persisted JSON without throwing', async () => {
    localStorage.setItem('dmp-player', '{not valid json')
    await expect(usePlayerStoreMounted()).resolves.toBeDefined()
  })
})
