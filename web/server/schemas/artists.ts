import { z } from 'zod'

export const monitorArtistBodySchema = z.object({
  monitored: z.boolean(),
})

export const monitorSelectedBodySchema = monitorArtistBodySchema.extend({
  ids: z.array(z.string().min(1)).min(1, 'must be a non-empty array'),
})
