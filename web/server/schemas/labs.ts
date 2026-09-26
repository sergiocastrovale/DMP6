import { z } from 'zod'

export const MOSAIC_MODES = ['chronological', 'gradient', 'random'] as const

// An unknown mode falls back to the default rather than failing the generation.
export const mosaicBodySchema = z.object({
  mode: z.unknown().optional().transform(v => MOSAIC_MODES.find(m => m === v) ?? 'chronological'),
})
