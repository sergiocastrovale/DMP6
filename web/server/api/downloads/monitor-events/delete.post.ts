import { requirePermission } from '~/server/utils/permissions'
import { deleteMonitorEvents } from '~/server/utils/monitorEvents'
import { readBodyOf } from '~/server/utils/requestValidation'
import { deleteMonitorEventsBodySchema } from '~/server/schemas/downloads'

// Permanent removal, unlike archive.post.ts. Two shapes: specific `ids`, or `allArchived` to empty
// the Archived list in one go.
export default defineEventHandler(async (event) => {
  await requirePermission(event, 'downloads.crud')

  const { ids, allArchived } = await readBodyOf(event, deleteMonitorEventsBodySchema)
  const hasIds = !!ids?.length

  // Neither is a client bug, and the safe reading of "delete nothing in particular" is not "delete
  // everything" - so it is rejected rather than defaulted.
  if (!hasIds && allArchived !== true) {
    throw createError({ statusCode: 400, message: 'ids or allArchived required' })
  }

  return { deleted: await deleteMonitorEvents({ ids, allArchived }) }
})
