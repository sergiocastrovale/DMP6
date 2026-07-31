import type { H3Event } from 'h3'
import type { Role } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import { ALL_PERMISSIONS, DEFAULT_MATRIX, type PermissionKey } from '~/shared/permissionsMatrix'

export { ALL_PERMISSIONS, DEFAULT_MATRIX, type PermissionKey }

let cache: Record<Role, Set<string>> | null = null

const matrixFromDefault = (): Record<Role, Set<string>> => ({
  VIEWER: new Set(DEFAULT_MATRIX.VIEWER),
  MANAGER: new Set(DEFAULT_MATRIX.MANAGER),
  ADMIN: new Set(DEFAULT_MATRIX.ADMIN),
})

const loadMatrix = async (): Promise<Record<Role, Set<string>>> => {
  if (cache) {return cache}
  const rows = await prisma.rolePermission.findMany()
  // Empty table (fresh DB, failed seed) means every role gets zero perms — ADMIN locked out of
  // everything gated by requirePermission. Fall back to the hardcoded default matrix instead.
  if (rows.length === 0) {
    cache = matrixFromDefault()
    return cache
  }
  const map: Record<string, Set<string>> = { VIEWER: new Set(), MANAGER: new Set(), ADMIN: new Set() }
  for (const row of rows) {
    map[row.role]!.add(row.permission)
  }
  cache = map as Record<Role, Set<string>>
  return cache
}

export const invalidatePermissionCache = (): void => {
  cache = null
}

export const hasPermission = async (role: Role, key: PermissionKey): Promise<boolean> => {
  const matrix = await loadMatrix()
  return matrix[role].has(key)
}

export const getPermissionsForRole = async (role: Role): Promise<string[]> => {
  const matrix = await loadMatrix()
  return Array.from(matrix[role]).sort()
}

export const requirePermission = async (event: H3Event, key: PermissionKey): Promise<void> => {
  const user = event.context.user
  if (!user) {throw createError({ statusCode: 401, message: 'Unauthorized' })}
  const ok = await hasPermission(user.role, key)
  if (!ok) {throw createError({ statusCode: 403, message: `Forbidden: missing ${key}` })}
}

export const requireRole = (event: H3Event, role: Role): void => {
  const user = event.context.user
  if (!user) {throw createError({ statusCode: 401, message: 'Unauthorized' })}
  if (user.role !== role) {throw createError({ statusCode: 403, message: 'Forbidden' })}
}

const ROLE_RANK: Record<Role, number> = { VIEWER: 0, MANAGER: 1, ADMIN: 2 }

// Unlike requireRole (exact match, used for ADMIN-only actions), this allows the given role OR
// anything ranked above it - e.g. requireRoleAtLeast(event, 'MANAGER') admits MANAGER and ADMIN.
export const requireRoleAtLeast = (event: H3Event, role: Role): void => {
  const user = event.context.user
  if (!user) {throw createError({ statusCode: 401, message: 'Unauthorized' })}
  if (ROLE_RANK[user.role] < ROLE_RANK[role]) {throw createError({ statusCode: 403, message: 'Forbidden' })}
}
