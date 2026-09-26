import { z } from 'zod'
import { MAX_EXCLUDE_IDS } from '~/helpers/constants'

const slider = (fallback: number) =>
  z.number().finite().optional().transform(v => Math.min(9, Math.max(0, Math.round(v ?? fallback))))

export const exploreBodySchema = z.object({
  energy: slider(5),
  era: slider(5),
  familiarity: slider(4),
  sound: slider(4),
  excludeIds: z.array(z.string()).optional().transform(ids => (ids ?? []).slice(-MAX_EXCLUDE_IDS)),
})

export const PLAY_SOURCES = ['QUEUE', 'PLAYLIST', 'CATALOGUE', 'EXPLORER', 'RANDOM'] as const

export const playEventBodySchema = z.object({
  trackId: z.string().min(1),
  source: z.enum(PLAY_SOURCES),
  duration: z.unknown().optional().transform(v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null)),
})
