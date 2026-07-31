import { describe, expect, it } from 'vitest'
import { maskSettingsSecrets, parseSecretField, SECRET_SETTINGS_FIELDS } from '../../../server/utils/settingsSecrets'

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
