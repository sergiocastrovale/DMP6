import { requirePermission } from '~/server/utils/permissions'
import { getAllMergeProgress } from '~/server/utils/mergeProgress'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'sync.view')
  return getAllMergeProgress()
})
