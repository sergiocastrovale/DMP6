import { z } from 'zod'

export const presenceBodySchema = z.object({
  clientId: z.string().min(1, 'is required'),
  trackId: z.string().nullish(),
  playing: z.boolean().optional(),
})
