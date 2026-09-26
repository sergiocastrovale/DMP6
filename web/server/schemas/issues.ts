import { z } from 'zod'
import { idsBodySchema } from '~/server/schemas/common'

export const revertBodySchema = idsBodySchema.extend({
  mode: z.enum(['undo', 'undo-resolved']),
})

// The fields an issue edit may carry are decided per type in the route; the body only has to be an object.
export const issuePatchBodySchema = z.record(z.string(), z.unknown())
