import { decryptSecret, encryptSecret } from '~/server/utils/secretBox'

// Settings fields that hold credentials — never sent to the browser as plaintext, and encrypted at rest when
// SETTINGS_ENCRYPTION_KEY is set (server/utils/secretBox.ts).
export const SECRET_SETTINGS_FIELDS = [
  'slskdApiKey',
  'awsSecretAccessKey',
  'fanartApiKey',
  'lastfmSecret',
  'lastfmSessionKey',
  'geniusSecret',
  'geniusAccessToken',
] as const

/** A row as it is stored: each secret string encrypted (when a key is configured). Null and absent values pass through. */
export const encryptSettingsSecrets = <T extends object>(data: T): T => {
  const out = { ...data } as Record<string, unknown>
  for (const field of SECRET_SETTINGS_FIELDS) {
    const value = out[field]
    if (typeof value === 'string') {
      out[field] = encryptSecret(value)
    }
  }
  return out as T
}

/** A stored row as the rest of the app sees it: secrets in plaintext, and null where one cannot be decrypted. */
export const decryptSettingsSecrets = <T extends object>(row: T): T => {
  const out = { ...row } as Record<string, unknown>
  for (const field of SECRET_SETTINGS_FIELDS) {
    const value = out[field]
    if (typeof value === 'string') {
      out[field] = decryptSecret(value)
    }
  }
  return out as T
}

/** Replace secret values with a `${field}Set` boolean so the browser never sees them, masked or not. */
export const maskSettingsSecrets = (row: Record<string, unknown>): Record<string, unknown> => {
  const masked: Record<string, unknown> = { ...row }
  for (const field of SECRET_SETTINGS_FIELDS) {
    masked[`${field}Set`] = !!row[field]
    masked[field] = ''
  }
  return masked
}

/**
 * Parse one secret field from a settings PUT body. Masked forms always render blank regardless of
 * whether a value is set, so blank must mean "untouched", not "clear" — only an explicit `null` clears.
 *   - null              -> clear
 *   - non-empty string  -> new value
 *   - undefined / ''    -> no change
 */
export const parseSecretField = (value: unknown): string | null | undefined => {
  if (value === null) {return null}
  if (typeof value === 'string' && value.length > 0) {return value}
  return undefined
}
