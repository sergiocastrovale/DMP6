import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

// Encryption at rest for the credentials kept in the database (the Settings secrets, Last.fm session keys), so a
// `./backup` dump or a read replica does not carry live keys. AES-256-GCM under a key derived from
// SETTINGS_ENCRYPTION_KEY - a dedicated variable, not SESSION_SECRET, so rotating one never bricks the other.
//
// A stored value is `enc:v1:` + base64(iv[12] | ciphertext | tag[16]). Anything without the prefix is a legacy
// plaintext value and is returned as it is, which is what lets the key be introduced on a live database: values are
// re-written encrypted the next time they are saved, or by `encryptStoredSecrets` at boot. The Rust scripts read a few
// of these columns and decrypt the same format (scripts/common/src/secrets.rs) - keep the two in step.
//
// Without a key nothing is encrypted (values stay plaintext, the old behaviour), but an already-encrypted value cannot
// be read, so a lost or changed key surfaces as "secret not set" and has to be re-entered.

const PREFIX = 'enc:v1:'
const IV_BYTES = 12
const TAG_BYTES = 16
export const MIN_ENCRYPTION_KEY_LENGTH = 32

export const isEncryptedSecret = (value: string): boolean => value.startsWith(PREFIX)

// The AES key, or null when encryption is not configured. A key too short to be one is a misconfiguration and fails
// loudly instead of quietly protecting nothing.
export const encryptionKey = (): Buffer | null => {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY
  if (!raw) {
    return null
  }
  if (raw.length < MIN_ENCRYPTION_KEY_LENGTH) {
    throw new Error(`SETTINGS_ENCRYPTION_KEY must be at least ${MIN_ENCRYPTION_KEY_LENGTH} characters (try: openssl rand -base64 32)`)
  }
  return createHash('sha256').update(raw, 'utf8').digest()
}

// Stores `plain` encrypted when a key is configured; otherwise, or when it already is encrypted, unchanged.
export const encryptSecret = (plain: string): string => {
  const key = encryptionKey()
  if (!key || !plain || isEncryptedSecret(plain)) {
    return plain
  }
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return PREFIX + Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64')
}

// The plaintext of a stored value; null when it is encrypted and cannot be opened (no key, wrong key, damaged).
export const decryptSecret = (stored: string): string | null => {
  if (!isEncryptedSecret(stored)) {
    return stored
  }
  try {
    const key = encryptionKey()
    if (!key) {
      return null
    }
    const blob = Buffer.from(stored.slice(PREFIX.length), 'base64')
    const decipher = createDecipheriv('aes-256-gcm', key, blob.subarray(0, IV_BYTES))
    decipher.setAuthTag(blob.subarray(blob.length - TAG_BYTES))
    return Buffer.concat([decipher.update(blob.subarray(IV_BYTES, blob.length - TAG_BYTES)), decipher.final()]).toString('utf8')
  }
  catch {
    return null
  }
}
