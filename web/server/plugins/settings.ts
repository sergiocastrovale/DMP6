import { ensureSettingsLoaded } from '~/server/utils/settings'

// Start loading the Settings row at boot rather than on the first request; 00.settingsReady middleware waits for it.
export default defineNitroPlugin(() => {
  ensureSettingsLoaded().catch(() => {})
})
