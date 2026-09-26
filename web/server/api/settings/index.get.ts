import { requirePermission } from '~/server/utils/permissions'
import { getSettingsRow } from '~/server/utils/settings'
import { maskSettingsSecrets } from '~/server/utils/settingsSecrets'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'variables.edit')
  const settings = await getSettingsRow({ fresh: true })
  return maskSettingsSecrets(settings ?? { id: 'main' })
})
