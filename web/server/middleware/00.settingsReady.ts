import { ensureSettingsLoaded } from '~/server/utils/settings'

// The first requests after a restart must see the DB settings (musicDir, image storage), not env defaults.
// Nitro does not await plugins, so the wait lives here; it is a resolved-promise check once the row has loaded.
export default defineEventHandler(async () => {
  await ensureSettingsLoaded()
})
