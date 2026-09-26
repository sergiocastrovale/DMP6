import { encryptionKey } from '~/server/utils/secretBox'
import { encryptStoredSecrets } from '~/server/utils/settingsEncryption'
import { monitorLog } from '~/server/utils/monitorLog'
import { errorMessage } from '~/helpers/functions'

// With SETTINGS_ENCRYPTION_KEY set, moves the secrets already in the database under it (see settingsEncryption.ts). A
// key that is set but too short throws here, so a misconfigured deploy stops at boot instead of running unprotected.
export default defineNitroPlugin(() => {
  if (!encryptionKey()) {
    return
  }
  encryptStoredSecrets()
    .then((count) => {
      if (count > 0) {
        monitorLog('notice', `settings encryption: ${count} stored secret(s) are now encrypted at rest`)
      }
    })
    .catch((e) => {
      monitorLog('error', `settings encryption failed: ${errorMessage(e)}`)
    })
})
