import { z } from 'zod'
import { ALL_PERMISSIONS } from '~/shared/permissionsMatrix'

const KNOWN = new Set<string>(ALL_PERMISSIONS)

const permissionList = z.array(z.string().refine(p => KNOWN.has(p), 'Unknown permission'))

// ADMIN is not editable (it holds every permission implicitly), so only the other two roles are required.
export const permissionsBodySchema = z.object({
  matrix: z.object({
    VIEWER: permissionList,
    MANAGER: permissionList,
  }),
})
