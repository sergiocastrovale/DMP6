export interface MediaSessionControls {
  isPlaying: () => boolean
  currentTime: () => number
  duration: () => number
  play: () => void
  pause: () => void
  next: () => void
  previous: () => void
  seek: (time: number) => void
}

export interface MediaSessionTrackMeta {
  title: string
  artist: string
  album: string
  artwork: string | null
}

const POSITION_THROTTLE_MS = 1000

const available = (): boolean => typeof navigator !== 'undefined' && 'mediaSession' in navigator

const toAbsoluteUrl = (path: string): string => {
  if (typeof location === 'undefined' || /^https?:\/\//.test(path)) {
    return path
  }
  return `${location.origin}${path}`
}

// OS media controls (lock screen / notification) bridge. Takes plain getter/action
// callbacks so it carries no Vue or Nuxt dependency and is unit-testable in isolation.
export const createMediaSession = (controls: MediaSessionControls) => {
  let lastPositionUpdate = 0

  const setMetadata = (meta: MediaSessionTrackMeta | null): void => {
    if (!available()) {
      return
    }
    if (!meta) {
      navigator.mediaSession.metadata = null
      return
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      artwork: meta.artwork ? [{ src: toAbsoluteUrl(meta.artwork), sizes: '512x512' }] : [],
    })
  }

  const setPlaybackState = (state: MediaSessionPlaybackState): void => {
    if (!available()) {
      return
    }
    navigator.mediaSession.playbackState = state
  }

  const updatePosition = (): void => {
    if (!available() || !('setPositionState' in navigator.mediaSession)) {
      return
    }
    const now = Date.now()
    if (now - lastPositionUpdate < POSITION_THROTTLE_MS) {
      return
    }
    lastPositionUpdate = now
    const duration = controls.duration()
    const position = controls.currentTime()
    if (!Number.isFinite(duration) || duration <= 0 || position > duration) {
      return
    }
    try {
      navigator.mediaSession.setPositionState({ duration, playbackRate: 1, position })
    }
    catch { /* position/duration race - ignore */ }
  }

  const resetPositionThrottle = (): void => {
    lastPositionUpdate = 0
  }

  const registerHandlers = (): void => {
    if (!available()) {
      return
    }
    const ms = navigator.mediaSession
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler): void => {
      try {
        ms.setActionHandler(action, handler)
      }
      catch { /* action unsupported by this browser - ignore */ }
    }
    set('play', () => {
      if (!controls.isPlaying()) {
        controls.play()
      }
    })
    set('pause', () => {
      if (controls.isPlaying()) {
        controls.pause()
      }
    })
    set('previoustrack', () => { controls.previous() })
    set('nexttrack', () => { controls.next() })
    set('seekto', (details) => {
      if (details.seekTime != null) {
        controls.seek(details.seekTime)
      }
    })
    set('seekbackward', (details) => {
      controls.seek(Math.max(0, controls.currentTime() - (details.seekOffset ?? 10)))
    })
    set('seekforward', (details) => {
      const limit = controls.duration() || Number.POSITIVE_INFINITY
      controls.seek(Math.min(limit, controls.currentTime() + (details.seekOffset ?? 10)))
    })
  }

  return { setMetadata, setPlaybackState, updatePosition, resetPositionThrottle, registerHandlers }
}
