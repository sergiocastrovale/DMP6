import { prisma } from '~/server/utils/prisma'
import { refreshSettings } from '~/server/utils/settings'
import { clearDownloadEnvironmentCache } from '~/server/utils/downloadEnvironment'
import { clearSlskdConfigCache } from '~/server/utils/slskd'
import { requirePermission } from '~/server/utils/permissions'
import { notifyDownloadsChanged } from '~/server/utils/downloadEvents'
import { encryptSettingsSecrets, maskSettingsSecrets } from '~/server/utils/settingsSecrets'
import { readBodyOf } from '~/server/utils/requestValidation'
import { settingsBodySchema } from '~/server/schemas/settings'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'variables.edit')

  // Absent keys stay undefined (stored value untouched); the schema owns null-clears, secrets and integers.
  const data = await readBodyOf(event, settingsBodySchema)

  // Remove undefined keys
  const clean = encryptSettingsSecrets(Object.fromEntries(
    Object.entries(data).filter(([, v]) => v !== undefined),
  ))

  const settings = await prisma.settings.upsert({
    where: { id: 'main' },
    update: clean,
    create: { id: 'main', ...clean },
  })

  // Reload now so the synchronous readers see the new values on the very next request, and drop the two
  // caches derived from them (the environment probe and the slskd URL/key).
  await refreshSettings()
  clearDownloadEnvironmentCache()
  clearSlskdConfigCache()
  // Downloads on/off, the slskd address and the like change what the Downloads pages show.
  notifyDownloadsChanged()

  return maskSettingsSecrets(settings)
})
