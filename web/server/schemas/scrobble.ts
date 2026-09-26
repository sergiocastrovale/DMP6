import { z } from 'zod'

export const nowPlayingBodySchema = z.object({
  trackId: z.string().min(1, 'is required'),
})

// Epoch milliseconds; a numeric string is accepted for older clients.
export const scrobbleBodySchema = nowPlayingBodySchema.extend({
  timestamp: z.coerce.number().finite().positive(),
})
