import { PRESENCE_PLAYING_STALE_MS, PRESENCE_STALE_MS } from '~/helpers/constants'

export type PresenceClientKind = 'web' | 'subsonic'

export interface PresenceTrack {
  trackId: string
  playing: boolean
  updatedAt: number
}

export interface PresenceEntry {
  userId: number
  clientId: string
  client: PresenceClientKind
  clientLabel: string
  lastSeenAt: number
  track: PresenceTrack | null
}

// In-memory, single-instance registry - see CLAUDE.md Data Model / helpers/constants.ts's PRESENCE_*
// comment. A dev server pointed at the shared prod DB (same MONITOR_PRIMARY split as the sync/index
// lock) keeps its own map, never leaking dev tabs into the admin panel of a NAS instance.
const registry = new Map<string, PresenceEntry>()

const registryKey = (userId: number, clientId: string): string => `${userId}:${clientId}`

// Whether an entry is still within its heartbeat window - callers should prune anything older
// before rendering rather than trust a stale row.
export const isOnline = (lastSeenAt: number, now: number = Date.now()): boolean =>
  now - lastSeenAt < PRESENCE_STALE_MS

// A track keeps showing after playback stops (staying "online" doesn't mean still listening), but
// its playing flag goes stale on its own, shorter clock so the UI can fall back to "paused".
export const isStillPlaying = (track: PresenceTrack, now: number = Date.now()): boolean =>
  track.playing && now - track.updatedAt < PRESENCE_PLAYING_STALE_MS

export interface TouchPresenceInput {
  userId: number
  clientId: string
  client: PresenceClientKind
  clientLabel: string
  now?: number
}

export const touchPresence = ({ userId, clientId, client, clientLabel, now = Date.now() }: TouchPresenceInput): void => {
  const existing = registry.get(registryKey(userId, clientId))
  registry.set(registryKey(userId, clientId), {
    userId,
    clientId,
    client,
    clientLabel,
    lastSeenAt: now,
    track: existing?.track ?? null,
  })
}

export const setNowPlaying = (userId: number, clientId: string, track: { trackId: string, playing: boolean } | null, now: number = Date.now()): void => {
  const k = registryKey(userId, clientId)
  const existing = registry.get(k)
  if (!existing) {return}
  existing.track = track ? { trackId: track.trackId, playing: track.playing, updatedAt: now } : null
  existing.lastSeenAt = now
}

export const clearPresence = (userId: number, clientId: string): void => {
  registry.delete(registryKey(userId, clientId))
}

// Prunes stale entries as a side effect (a dead tab that never sent a leave beacon - closed laptop,
// crashed browser - would otherwise sit in the map forever) and returns what's left, newest first.
export const listOnline = (now: number = Date.now()): PresenceEntry[] => {
  const live: PresenceEntry[] = []
  for (const [k, entry] of registry) {
    if (isOnline(entry.lastSeenAt, now)) {
      live.push(entry)
    }
    else {
      registry.delete(k)
    }
  }
  return live.sort((a, b) => b.lastSeenAt - a.lastSeenAt)
}

// Test-only escape hatch - the registry is module-level state that would otherwise leak between
// test cases importing this module.
export const _resetPresenceForTest = (): void => {
  registry.clear()
}
