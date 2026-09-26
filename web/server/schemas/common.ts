import { z } from 'zod'

export const idsBodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'must be a non-empty array'),
})

// No ids (or an empty body) means "everything"/"nothing" as each route documents; a malformed ids value
// is a 400, never a silent bulk action.
export const optionalIdsBodySchema = z.object({
  ids: z.array(z.string()).optional(),
})
