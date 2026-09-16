import type { Role } from '@prisma/client'

export type SessionUser = {
  id: number
  username: string
  email: string
  role: Role
  mustChangePassword: boolean
}

export type MeResponse = SessionUser & {
  permissions: string[]
}

export interface AdminUser {
  id: number
  username: string
  email: string
  role: string
  mustChangePassword: boolean
  createdAt: string
}

export type SessionTokenPayload = { userId: number, exp: number, ph: string, tv: number }

export interface PermissionsMatrixResponse {
  matrix: Record<string, string[]>
  allPermissions: string[]
}

export type LoginThrottleEntry = { failures: number, lockedUntil: number }

// Settings → Users "connected now" panel (server/api/users/presence.get.ts,
// components/settings/UsersLive.vue). One entry per online user, one session per tab/device/Subsonic
// client - a user open in two tabs shows two sessions.
export interface UserPresenceTrack {
  trackId: string
  title: string
  album: string | null
  releaseId: string | null
  artist: string | null
  artistSlug: string | null
  image: string | null
  imageUrl: string | null
  playing: boolean
}

export interface UserPresenceSession {
  clientId: string
  client: 'web' | 'subsonic'
  clientLabel: string
  lastSeenAt: string
  nowPlaying: UserPresenceTrack | null
}

export interface UserPresence {
  userId: number
  username: string
  sessions: UserPresenceSession[]
}

export interface CachedAuthUser {
  id: number
  username: string
  email: string
  role: Role
  mustChangePassword: boolean
  passwordHash: string
  tokenVersion: number
}

declare module 'h3' {
  interface H3EventContext {
    user?: SessionUser
  }
}
