import { prisma } from '~/server/utils/prisma'
import { requireRole, ALL_PERMISSIONS } from '~/server/utils/permissions'

export default defineEventHandler(async (event) => {
  requireRole(event, 'ADMIN')

  const rows = await prisma.rolePermission.findMany()

  const matrix: Record<string, string[]> = { VIEWER: [], MANAGER: [], ADMIN: [] }
  for (const row of rows) {
    matrix[row.role]!.push(row.permission)
  }
  for (const role of Object.keys(matrix)) {
    matrix[role]!.sort()
  }

  return {
    matrix,
    allPermissions: ALL_PERMISSIONS,
  }
})
