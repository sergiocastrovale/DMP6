import { prisma } from '~/server/utils/prisma'
import { encryptionKey, encryptSecret, isEncryptedSecret } from '~/server/utils/secretBox'
import { SECRET_SETTINGS_FIELDS } from '~/server/utils/settingsSecrets'
import { invalidateSettings } from '~/server/utils/settings'

// Brings values stored before SETTINGS_ENCRYPTION_KEY existed under it: every plaintext secret in the Settings row and
// every Last.fm session key is re-written encrypted. Safe to run on every boot and while the app is serving - each write
// only lands if the stored value is still the plaintext that was read (compare-and-set), so it can never overwrite a
// save that raced it, and once everything is encrypted it does nothing. Returns how many values it rewrote.
export const encryptStoredSecrets = async (): Promise<number> => {
  if (!encryptionKey()) {
    return 0
  }
  let rewritten = 0

  const settings = await prisma.settings.findUnique({ where: { id: 'main' } })
  if (settings) {
    for (const field of SECRET_SETTINGS_FIELDS) {
      const plain = settings[field]
      if (plain && !isEncryptedSecret(plain)) {
        const { count } = await prisma.settings.updateMany({
          where: { id: 'main', [field]: plain },
          data: { [field]: encryptSecret(plain) },
        })
        rewritten += count
      }
    }
  }

  const sessions = await prisma.userLastfmSession.findMany({ select: { userId: true, sessionKey: true } })
  for (const { userId, sessionKey } of sessions) {
    if (!isEncryptedSecret(sessionKey)) {
      const { count } = await prisma.userLastfmSession.updateMany({
        where: { userId, sessionKey },
        data: { sessionKey: encryptSecret(sessionKey) },
      })
      rewritten += count
    }
  }

  if (rewritten > 0) {
    invalidateSettings()
  }
  return rewritten
}
