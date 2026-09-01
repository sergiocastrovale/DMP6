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
