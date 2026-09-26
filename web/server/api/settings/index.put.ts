import { prisma } from '~/server/utils/prisma'
import { invalidateSettingsCache } from '~/server/utils/settingsCache'
import { requirePermission } from '~/server/utils/permissions'
import { maskSettingsSecrets } from '~/server/utils/settingsSecrets'
import { readBodyOf } from '~/server/utils/requestValidation'
import { settingsBodySchema } from '~/server/schemas/settings'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'variables.edit')

  // Absent keys stay undefined (stored value untouched); the schema owns null-clears, secrets and integers.
  const data = await readBodyOf(event, settingsBodySchema)

  // Remove undefined keys
  const clean = Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined),
  )

  const settings = await prisma.settings.upsert({
    where: { id: 'main' },
    update: clean,
    create: { id: 'main', ...clean },
  })

  invalidateSettingsCache()

  return maskSettingsSecrets(settings)
})
