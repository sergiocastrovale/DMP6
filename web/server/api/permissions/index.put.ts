import type { Role } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'
import {
  ALL_PERMISSIONS,
  invalidatePermissionCache,
  requireRole,
} from '~/server/utils/permissions'

const ROLES: Role[] = ['VIEWER', 'MANAGER', 'ADMIN']
const PERM_SET = new Set<string>(ALL_PERMISSIONS)

export default defineEventHandler(async (event) => {
  requireRole(event, 'ADMIN')

  const body = (await readBody(event)) ?? {}
  const matrix = body.matrix as Record<string, string[]> | undefined

  if (!matrix || typeof matrix !== 'object') {
    throw createError({ statusCode: 400, message: 'Missing matrix' })
  }

  for (const role of ROLES) {
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

  const adminPerms = new Set(matrix.ADMIN)
  if (!adminPerms.has('variables.edit')) {
    throw createError({ statusCode: 400, message: 'Admin must retain variables.edit' })
  }

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({}),
    prisma.rolePermission.createMany({
      data: ROLES.flatMap((role) =>
        matrix[role]!.map((permission: string) => ({ role, permission })),
      ),
    }),
  ])

  invalidatePermissionCache()

  return { ok: true }
})
