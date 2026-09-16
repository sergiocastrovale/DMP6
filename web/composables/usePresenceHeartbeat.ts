import { PRESENCE_HEARTBEAT_MS } from '~/helpers/constants'

export interface PresenceTrackInfo {
  trackId: string
  playing: boolean
}

const CLIENT_ID_KEY = 'dmp-presence-client-id'

// One id per tab, not per user - sessionStorage (not localStorage) so two tabs of the same user show
// as two sessions in the admin panel. Falls back to an unstable per-call id in a private window /
// blocked storage rather than not heartbeating at all.
const getClientId = (): string => {
  try {
    const existing = sessionStorage.getItem(CLIENT_ID_KEY)
    if (existing) {return existing}
    const id = crypto.randomUUID()
    sessionStorage.setItem(CLIENT_ID_KEY, id)
    return id
  }
  catch {
    return crypto.randomUUID()
  }
}

const beaconAvailable = (): boolean => typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function'

// Factory (not a Vue composable proper) so it's testable with fake timers and a mocked $fetch, same
// pattern as composables/usePlayEventTracker.ts. plugins/presence.client.ts owns wiring it to auth
// state, route, and stores/player.ts.
export const createPresenceHeartbeat = () => {
  let clientId: string | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  const send = (track: PresenceTrackInfo | null) => {
    if (!clientId) {return}
    $fetch('/api/me/presence', {
      method: 'POST',
      body: { clientId, trackId: track?.trackId ?? null, playing: track?.playing ?? false },
    }).catch(() => {})
  }

  const start = (getTrack: () => PresenceTrackInfo | null) => {
    if (timer) {return}
    clientId = getClientId()
    send(getTrack())
    timer = setInterval(() => send(getTrack()), PRESENCE_HEARTBEAT_MS)
  }

  const stop = () => {
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    clientId = null
  }

  // Page hide (tab close/navigate away) - the page may not survive a normal fetch, so this goes out
  // via sendBeacon instead, same trick as usePlayEventTracker's finishOnHide.
  const leave = () => {
    if (!clientId || !beaconAvailable()) {return}
    const body = JSON.stringify({ clientId })
    navigator.sendBeacon('/api/me/presence/leave', new Blob([body], { type: 'text/plain' }))
  }

  return { start, stop, leave, notify: send }
}
