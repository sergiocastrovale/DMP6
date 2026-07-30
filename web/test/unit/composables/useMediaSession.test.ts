import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMediaSession, type MediaSessionControls } from '../../../composables/useMediaSession'

class FakeMediaMetadata {
  title?: string
  artist?: string
  album?: string
  artwork?: { src: string, sizes?: string }[]
  constructor(init: Record<string, unknown>) {
    Object.assign(this, init)
  }
}

let mediaSession: {
  metadata: unknown
  playbackState: string
  setActionHandler: ReturnType<typeof vi.fn>
  setPositionState: ReturnType<typeof vi.fn>
}
type ActionDetails = { seekTime?: number, seekOffset?: number }
let handlers: Record<string, (details: ActionDetails) => void>

const installMediaSession = (): void => {
  handlers = {}
  mediaSession = {
    metadata: undefined,
    playbackState: 'none',
    setActionHandler: vi.fn((action: string, handler) => { handlers[action] = handler }),
    setPositionState: vi.fn(),
  }
  ;(globalThis as Record<string, unknown>).MediaMetadata = FakeMediaMetadata
  Object.defineProperty(globalThis.navigator, 'mediaSession', { value: mediaSession, configurable: true })
}

// Fire a registered action handler (throws if it was never registered).
const fire = (action: string, details: ActionDetails = {}): void => {
  const handler = handlers[action]
  if (!handler) {
    throw new Error(`handler not registered: ${action}`)
  }
  handler(details)
}

// Controllable playback state backing the injected controls.
let state: { playing: boolean, time: number, duration: number }
let controls: MediaSessionControls

beforeEach(() => {
  installMediaSession()
  state = { playing: false, time: 0, duration: 200 }
  controls = {
    isPlaying: () => state.playing,
    currentTime: () => state.time,
    duration: () => state.duration,
    play: vi.fn(),
    pause: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    seek: vi.fn(),
  }
})

describe('createMediaSession - metadata', () => {
  it('builds MediaMetadata with an absolute artwork URL from a relative path', () => {
    const media = createMediaSession(controls)
    media.setMetadata({ title: 'Song', artist: 'Band', album: 'LP', artwork: '/img/releases/cover.jpg' })

    const meta = mediaSession.metadata as FakeMediaMetadata
    expect(meta).toBeInstanceOf(FakeMediaMetadata)
    expect(meta.title).toBe('Song')
    expect(meta.artist).toBe('Band')
    expect(meta.album).toBe('LP')
    expect(meta.artwork?.[0]?.src).toBe(`${location.origin}/img/releases/cover.jpg`)
    expect(meta.artwork?.[0]?.sizes).toBe('512x512')
  })

  it('keeps an already-absolute artwork URL (S3) unchanged', () => {
    const media = createMediaSession(controls)
    media.setMetadata({ title: 'a', artist: 'b', album: 'c', artwork: 'https://cdn.example.com/x.jpg' })
    const meta = mediaSession.metadata as FakeMediaMetadata
    expect(meta.artwork?.[0]?.src).toBe('https://cdn.example.com/x.jpg')
  })

  it('emits an empty artwork array when there is no image', () => {
    const media = createMediaSession(controls)
    media.setMetadata({ title: 'a', artist: 'b', album: 'c', artwork: null })
    const meta = mediaSession.metadata as FakeMediaMetadata
    expect(meta.artwork).toEqual([])
  })

  it('clears metadata when passed null', () => {
    const media = createMediaSession(controls)
    media.setMetadata(null)
    expect(mediaSession.metadata).toBeNull()
  })
})

describe('createMediaSession - playback state', () => {
  it('forwards playback state to the media session', () => {
    const media = createMediaSession(controls)
    media.setPlaybackState('playing')
    expect(mediaSession.playbackState).toBe('playing')
    media.setPlaybackState('paused')
    expect(mediaSession.playbackState).toBe('paused')
  })
})

describe('createMediaSession - action handlers', () => {
  it('registers handlers for all transport actions', () => {
    createMediaSession(controls).registerHandlers()
    expect(Object.keys(handlers).sort()).toEqual(
      ['nexttrack', 'pause', 'play', 'previoustrack', 'seekbackward', 'seekforward', 'seekto'].sort(),
    )
  })

  it('next/previous route to the injected actions', () => {
    createMediaSession(controls).registerHandlers()
    fire('nexttrack')
    fire('previoustrack')
    expect(vi.mocked(controls.next)).toHaveBeenCalledOnce()
    expect(vi.mocked(controls.previous)).toHaveBeenCalledOnce()
  })

  it('play resumes only when paused; pause stops only when playing', () => {
    createMediaSession(controls).registerHandlers()

    state.playing = false
    fire('play')
    expect(vi.mocked(controls.play)).toHaveBeenCalledOnce()

    state.playing = true
    fire('play')
    expect(vi.mocked(controls.play)).toHaveBeenCalledOnce() // not called again

    fire('pause')
    expect(vi.mocked(controls.pause)).toHaveBeenCalledOnce()
  })

  it('seekto seeks to the requested time', () => {
    createMediaSession(controls).registerHandlers()
    fire('seekto', { seekTime: 42 })
    expect(vi.mocked(controls.seek)).toHaveBeenCalledWith(42)
  })

  it('seekbackward clamps at 0 and seekforward clamps at duration', () => {
    createMediaSession(controls).registerHandlers()
    state.time = 5
    fire('seekbackward', { seekOffset: 10 })
    expect(vi.mocked(controls.seek)).toHaveBeenCalledWith(0)

    state.time = 195
    state.duration = 200
    fire('seekforward', { seekOffset: 10 })
    expect(vi.mocked(controls.seek)).toHaveBeenLastCalledWith(200)
  })
})

describe('createMediaSession - position state', () => {
  it('reports duration/position and throttles repeat calls within 1s', () => {
    const media = createMediaSession(controls)
    state.time = 10
    state.duration = 200

    media.updatePosition()
    media.updatePosition() // throttled
    expect(mediaSession.setPositionState).toHaveBeenCalledTimes(1)
    expect(mediaSession.setPositionState).toHaveBeenCalledWith({ duration: 200, playbackRate: 1, position: 10 })

    media.resetPositionThrottle()
    state.time = 11
    media.updatePosition()
    expect(mediaSession.setPositionState).toHaveBeenCalledTimes(2)
  })

  it('skips when position exceeds duration or duration is not positive', () => {
    const media = createMediaSession(controls)

    state.time = 300
    state.duration = 200
    media.updatePosition()
    media.resetPositionThrottle()

    state.time = 0
    state.duration = 0
    media.updatePosition()

    expect(mediaSession.setPositionState).not.toHaveBeenCalled()
  })

  it('swallows setPositionState errors (duration/position race)', () => {
    mediaSession.setPositionState.mockImplementation(() => { throw new Error('invalid state') })
    const media = createMediaSession(controls)
    state.time = 10
    state.duration = 200
    expect(() => media.updatePosition()).not.toThrow()
  })
})
