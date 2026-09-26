import { z } from 'zod'

export const createPlaylistBodySchema = z.object({
  name: z.string().min(1, 'is required'),
  description: z.string().nullish().transform(v => v || null),
})

export const addPlaylistTrackBodySchema = z.object({
  trackId: z.string().min(1, 'is required'),
})
