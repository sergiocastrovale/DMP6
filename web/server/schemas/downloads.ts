import { z } from 'zod'

export const acquireBodySchema = z.object({
  mbReleaseRowId: z.string().min(1, 'is required'),
  // Re-download of an incomplete copy: names the LocalRelease this download replaces.
  replacesLocalReleaseId: z.string().nullish().transform(v => v || undefined),
})

export const cancelDownloadBodySchema = z.object({
  id: z.string().min(1, 'is required'),
  username: z.string().nullish().transform(v => v ?? ''),
})

export const pauseBodySchema = z.object({
  paused: z.boolean(),
})

// `ids` omitted: delete only what `allArchived` names. Neither is rejected by the route, since the safe
// reading of "delete nothing in particular" is not "delete everything".
export const deleteMonitorEventsBodySchema = z.object({
  ids: z.array(z.string()).optional(),
  allArchived: z.boolean().optional(),
})
