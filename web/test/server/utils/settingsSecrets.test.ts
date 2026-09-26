import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decryptSettingsSecrets, encryptSettingsSecrets, maskSettingsSecrets, parseSecretField, SECRET_SETTINGS_FIELDS } from '../../../server/utils/settingsSecrets'
import { isEncryptedSecret } from '../../../server/utils/secretBox'

describe('settingsSecrets', () => {
  describe('maskSettingsSecrets', () => {
    it('blanks every secret field and adds a Set boolean flag', () => {
      const row: Record<string, unknown> = { id: 'main', slskdUrl: 'http://x' }
      for (const field of SECRET_SETTINGS_FIELDS) {row[field] = 'super-secret-value'}

      const masked = maskSettingsSecrets(row)

      expect(masked.slskdUrl).toBe('http://x') // non-secret fields pass through untouched
      for (const field of SECRET_SETTINGS_FIELDS) {
        expect(masked[field]).toBe('')
        expect(masked[`${field}Set`]).toBe(true)
      }
    })

    it('reports Set: false for unset (null/undefined) secret fields', () => {
      const row: Record<string, unknown> = { id: 'main', slskdApiKey: null }
      const masked = maskSettingsSecrets(row)
      expect(masked.slskdApiKeySet).toBe(false)
      expect(masked.slskdApiKey).toBe('')
    })
  })

  describe('parseSecretField', () => {
    it('treats explicit null as a clear', () => {
      expect(parseSecretField(null)).toBeNull()
    })

    it('treats a non-empty string as a new value', () => {
      expect(parseSecretField('new-secret')).toBe('new-secret')
    })

    it('treats undefined (key absent) as no change', () => {
      expect(parseSecretField(undefined)).toBeUndefined()
    })

    it('treats an empty string as no change, not a clear — masked forms always render blank', () => {
      expect(parseSecretField('')).toBeUndefined()
    })
  })
})

describe('encryptSettingsSecrets / decryptSettingsSecrets', () => {
  beforeEach(() => {
    process.env.SETTINGS_ENCRYPTION_KEY = 'x'.repeat(40)
  })
  afterEach(() => {
    delete process.env.SETTINGS_ENCRYPTION_KEY
  })

  it('encrypts only secret string fields and leaves nulls and everything else alone', () => {
    const stored = encryptSettingsSecrets({ slskdUrl: 'http://x', slskdApiKey: 'k1', geniusSecret: null, fanartApiKey: 'f' })

    expect(stored.slskdUrl).toBe('http://x')
    expect(stored.geniusSecret).toBeNull()
    expect(isEncryptedSecret(stored.slskdApiKey)).toBe(true)
    expect(isEncryptedSecret(stored.fanartApiKey)).toBe(true)
  })

  it('round-trips a row, and turns a value it cannot open into null', () => {
    const stored = encryptSettingsSecrets({ slskdApiKey: 'k1', lastfmSecret: 'legacy' })
    expect(decryptSettingsSecrets(stored)).toEqual({ slskdApiKey: 'k1', lastfmSecret: 'legacy' })

    delete process.env.SETTINGS_ENCRYPTION_KEY
    expect(decryptSettingsSecrets(stored)).toEqual({ slskdApiKey: null, lastfmSecret: null })
  })

  it('reads a row written before encryption existed', () => {
    expect(decryptSettingsSecrets({ slskdApiKey: 'plain' })).toEqual({ slskdApiKey: 'plain' })
  })
})
