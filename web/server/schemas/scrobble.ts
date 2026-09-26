import { z } from 'zod'

export const nowPlayingBodySchema = z.object({
  trackId: z.string().min(1, 'is required'),
})
