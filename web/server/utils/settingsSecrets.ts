// Settings fields that hold credentials — never sent to the browser as plaintext.
export const SECRET_SETTINGS_FIELDS = [
  'slskdApiKey',
  'awsSecretAccessKey',
  'lastfmSecret',
  'lastfmSessionKey',
] as const

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
