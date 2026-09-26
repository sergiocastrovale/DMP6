import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decryptSecret, encryptionKey, encryptSecret, isEncryptedSecret } from '../../../server/utils/secretBox'

const KEY = 'k'.repeat(40)

describe('secretBox', () => {
  beforeEach(() => {
    process.env.SETTINGS_ENCRYPTION_KEY = KEY
  })
  afterEach(() => {
    delete process.env.SETTINGS_ENCRYPTION_KEY
  })

  it('round-trips a secret, including non-ASCII', () => {
    for (const plain of ['abc123', 'pässwörd-日本語', 'a'.repeat(500)]) {
      const stored = encryptSecret(plain)
      expect(isEncryptedSecret(stored)).toBe(true)
      expect(stored).not.toContain(plain)
      expect(decryptSecret(stored)).toBe(plain)
    }
  })

  it('encrypts the same value differently each time (fresh IV)', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'))
  })

  it('leaves a value alone when it is empty or already encrypted', () => {
    expect(encryptSecret('')).toBe('')
    const stored = encryptSecret('x')
    expect(encryptSecret(stored)).toBe(stored)
  })

  it('reads a legacy plaintext value as it is, with or without a key', () => {
    expect(decryptSecret('plain-value')).toBe('plain-value')
    delete process.env.SETTINGS_ENCRYPTION_KEY
    expect(decryptSecret('plain-value')).toBe('plain-value')
  })

  it('stores plaintext when no key is configured', () => {
    delete process.env.SETTINGS_ENCRYPTION_KEY
    expect(encryptSecret('secret')).toBe('secret')
  })

  it('cannot open an encrypted value without the key, with a different key, or once damaged', () => {
    const stored = encryptSecret('secret')
    delete process.env.SETTINGS_ENCRYPTION_KEY
    expect(decryptSecret(stored)).toBeNull()

    process.env.SETTINGS_ENCRYPTION_KEY = 'z'.repeat(40)
    expect(decryptSecret(stored)).toBeNull()

    process.env.SETTINGS_ENCRYPTION_KEY = KEY
    const damaged = stored.slice(0, -4) + (stored.endsWith('AAAA') ? 'BBBB' : 'AAAA')
    expect(decryptSecret(damaged)).toBeNull()
    expect(decryptSecret('enc:v1:!!!not-base64')).toBeNull()
  })

  it('rejects a key that is too short instead of protecting nothing', () => {
    process.env.SETTINGS_ENCRYPTION_KEY = 'short'
    expect(() => encryptionKey()).toThrow(/at least 32/)
  })

  it('matches the Rust reader: a fixed vector decrypts to its plaintext', () => {
    // Produced by this module with this key; scripts/common/src/secrets.rs decrypts the same
    // string, so a change to either side's format fails one of the two.
    process.env.SETTINGS_ENCRYPTION_KEY = 'dmp-test-key-dmp-test-key-dmp-test-key'
    expect(decryptSecret('enc:v1:ADCnirZM3sEQA40cjbHswTeZXmmKn2gKq+NmmFkHnUBQSOblhhSi8n3kxRJl6Z8=')).toBe('fanart-secret-value')
  })
})
