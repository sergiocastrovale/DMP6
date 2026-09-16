import { isSkip, shouldScrobble } from '~/helpers/playerLogic'
import type { PlaySource } from '~/types/player'

const PROGRESS_INTERVAL_MS = 15000

const beaconAvailable = (): boolean => typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'

// Per-listen event log (PlayEvent) tracker - one instance shared by the normal player and the Explore
// player, since both route through stores/player.ts's single playTrack(). Carries no Vue/Nuxt
// dependency beyond the global $fetch (already stubbed the same way in every other composable test),
// so it's unit-testable with fake timers and a mocked fetch.
export const createPlayEventTracker = () => {
  let eventId: string | null = null
  let listenedSeconds = 0
  let lastAudioTime = 0
  let counted = false
  let lastProgressAt = 0

  const patch = (body: Record<string, unknown>) => {
    if (!eventId) {return}
    $fetch(`/api/play-events/${eventId}`, { method: 'PATCH', body }).catch(() => {})
  }

  // Regular finish - track changed, natural end, or an in-app dismiss. Sent as a normal PATCH since
  // the page is still alive to wait for it.
  const finish = (reason: 'ended' | 'changed' | 'dismissed') => {
    if (!eventId) {return}
    const id = eventId
    eventId = null
    const skipped = isSkip(reason, counted)
    $fetch(`/api/play-events/${id}`, {
      method: 'PATCH',
      body: { listenedSeconds: Math.round(listenedSeconds), ended: true, skipped },
    }).catch(() => {})
  }

  // Page hide (tab close/navigate away) - the page may not survive long enough for a normal fetch to
  // complete, so this goes out via sendBeacon instead. Never counted as a skip: closing the tab isn't
  // choosing to skip the track, and the listen may already have crossed the counted threshold anyway.
  const finishOnHide = () => {
    if (!eventId || !beaconAvailable()) {return}
    const id = eventId
    eventId = null
    const body = JSON.stringify({ listenedSeconds: Math.round(listenedSeconds), ended: true, skipped: false })
    navigator.sendBeacon(`/api/play-events/${id}/finish`, new Blob([body], { type: 'text/plain' }))
  }

  const start = async (trackId: string, source: PlaySource, duration: number) => {
    finish('changed')
    listenedSeconds = 0
    lastAudioTime = 0
    counted = false
    // Starts the 15s progress-patch clock from playback start, not epoch 0 - otherwise the very first
    // timeupdate tick (~0.25s in) would always fire an immediate, redundant patch.
    lastProgressAt = Date.now()
    try {
      const res = await $fetch<{ id: string }>('/api/play-events', {
        method: 'POST',
        body: { trackId, source, duration },
      })
      eventId = res.id
    }
    catch {
      eventId = null
    }
  }

  // Called from the audio element's timeupdate handler. Ignores seeks/pauses/loops (a non-positive or
  // multi-second jump) so scrubbing back and forth doesn't inflate listenedSeconds - only forward
  // real-time playback does.
  const onTimeUpdate = (currentTime: number, duration: number) => {
    if (!eventId) {return}
    const delta = currentTime - lastAudioTime
    lastAudioTime = currentTime
    if (delta <= 0 || delta >= 2) {return}
    listenedSeconds += delta

    const justCounted = !counted && shouldScrobble({ duration, currentTime })
    if (justCounted) {counted = true}

    const now = Date.now()
    if (justCounted || now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
      lastProgressAt = now
      patch({ listenedSeconds: Math.round(listenedSeconds), ...(justCounted ? { counted: true } : {}) })
    }
  }

  return { start, onTimeUpdate, finish, finishOnHide }
}
