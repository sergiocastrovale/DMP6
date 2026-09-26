import type { Role } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import {
  ALL_PERMISSIONS,
  invalidatePermissionCache,
  requireRole,
} from '~/server/utils/permissions'

// ADMIN is not editable: it holds every permission implicitly (server/utils/permissions.ts). Its rows are
// rewritten from ALL_PERMISSIONS below so the table stays a faithful picture of who can do what.
const EDITABLE_ROLES: Role[] = ['VIEWER', 'MANAGER']
const PERM_SET = new Set<string>(ALL_PERMISSIONS)

export default defineEventHandler(async (event) => {
  requireRole(event, 'ADMIN')

  const body = (await readBody(event)) ?? {}
  const matrix = body.matrix as Record<string, string[]> | undefined

  if (!matrix || typeof matrix !== 'object') {
    throw createError({ statusCode: 400, message: 'Missing matrix' })
  }

  for (const role of EDITABLE_ROLES) {
    const perms = matrix[role]
    if (!Array.isArray(perms)) {
      throw createError({ statusCode: 400, message: `Missing permissions for role ${role}` })
    }
    for (const p of perms) {
      if (!PERM_SET.has(p)) {
        throw createError({ statusCode: 400, message: `Unknown permission: ${p}` })
      }
    }
  }

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({}),
    prisma.rolePermission.createMany({
      data: [
        ...EDITABLE_ROLES.flatMap(role => [...new Set(matrix[role]!)].map((permission: string) => ({ role, permission }))),
        ...ALL_PERMISSIONS.map(permission => ({ role: 'ADMIN' as const, permission })),
      ],
    }),
  ])

  invalidatePermissionCache()

  return { ok: true }
})
