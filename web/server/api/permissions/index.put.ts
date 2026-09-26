import { prisma } from '~/server/utils/prisma'
import {
  ALL_PERMISSIONS,
  invalidatePermissionCache,
  requirePermission,
} from '~/server/utils/permissions'
import { readBodyOf } from '~/server/utils/requestValidation'
import { permissionsBodySchema } from '~/server/schemas/permissions'

// ADMIN is not editable: it holds every permission implicitly (server/utils/permissions.ts). Its rows are
// rewritten from ALL_PERMISSIONS below so the table stays a faithful picture of who can do what.
const EDITABLE_ROLES = ['VIEWER', 'MANAGER'] as const

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'permissions.manage')

  const { matrix } = await readBodyOf(event, permissionsBodySchema)

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({}),
    prisma.rolePermission.createMany({
      data: [
        ...EDITABLE_ROLES.flatMap(role => [...new Set(matrix[role])].map((permission: string) => ({ role, permission }))),
        ...ALL_PERMISSIONS.map(permission => ({ role: 'ADMIN' as const, permission })),
      ],
    }),
  ])

  invalidatePermissionCache()

  return { ok: true }
})
