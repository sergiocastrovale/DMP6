import { getPermissionsForRole } from '~/server/utils/permissions'
import type { MeResponse } from '~/types/auth'

export default defineEventHandler(async (event): Promise<MeResponse> => {
  const user = event.context.user
  if (!user) {
    throw createError({ statusCode: 401, message: 'Unauthorized' })
  }

  const permissions = await getPermissionsForRole(user.role)

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
    permissions,
  }
})
