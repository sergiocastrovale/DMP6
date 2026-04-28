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

declare module 'h3' {
  interface H3EventContext {
    user?: SessionUser
  }
}
