import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'
import { maskSettingsSecrets } from '~/server/utils/settingsSecrets'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'variables.edit')
  const settings = await prisma.settings.findUnique({ where: { id: 'main' } })
  return maskSettingsSecrets(settings ?? { id: 'main' })
})
