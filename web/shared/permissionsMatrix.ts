import type { Role } from '@prisma/client'

// Single source of truth for the permission matrix, imported by both server/utils/permissions.ts (the
// runtime fallback when RolePermission is empty) and prisma/seed.ts (the initial DB rows). Previously
// each file kept its own hand-copied matrix, which drifted (docs audit #38). Plain relative imports
// only, no `~` alias - prisma/seed.ts runs standalone via tsx, outside Nuxt's build/alias resolution.
export const ALL_PERMISSIONS = [
  'favorites.view',
  'favorites.crud',
  'playlists.view',
  'playlists.crud',
  'play.view',
  'sync.view',
  'sync.run',
  'downloads.crud',
  'issues.view',
  // Writes: queue/edit/undo issue fixes and run ./fix (which rewrites audio tags). issues.view only reads.
  'issues.fix',
  // Deleting the fix-history audit trail.
  'issues.admin',
  'variables.edit',
  // Administration surfaces that used to be hard-wired to the ADMIN role. Now ordinary keys: ADMIN holds them
  // implicitly (server/utils/permissions.ts), and Settings -> Permissions can delegate any of them.
  'users.manage',
  'permissions.manage',
  'playlists.generate',
  'labs.mosaic',
  'terminal.control',
] as const

export type PermissionKey = typeof ALL_PERMISSIONS[number]

export const DEFAULT_MATRIX: Record<Role, PermissionKey[]> = {
  VIEWER: ['favorites.view', 'favorites.crud', 'playlists.view', 'playlists.crud', 'play.view'],
  MANAGER: [
    'favorites.view',
    'favorites.crud',
    'playlists.view',
    'playlists.crud',
    'play.view',
    'sync.view',
    'sync.run',
    'downloads.crud',
    // The album mosaic was requireRoleAtLeast('MANAGER'); keep exactly that access by default.
    'labs.mosaic',
  ],
  ADMIN: [...ALL_PERMISSIONS],
}
