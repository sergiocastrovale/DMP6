import { z } from 'zod'

export const idsBodySchema = z.object({
  ids: z.array(z.string().min(1)).min(1, 'must be a non-empty array'),
})

export const revertBodySchema = idsBodySchema.extend({
  mode: z.enum(['undo', 'undo-resolved']),
})

// No ids (or an empty body) means "everything"; a malformed ids value is a 400, never a silent delete-all.
export const optionalIdsBodySchema = z.object({
  ids: z.array(z.string()).optional(),
})

// The fields an issue edit may carry are decided per type in the route; the body only has to be an object.
export const issuePatchBodySchema = z.record(z.string(), z.unknown())
