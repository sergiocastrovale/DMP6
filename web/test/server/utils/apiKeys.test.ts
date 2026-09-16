import { describe, expect, it } from 'vitest'
import { generateApiKey, hashApiKey } from '../../../server/utils/apiKeys'

describe('generateApiKey', () => {
  it('is prefixed and sufficiently random/unique', () => {
    const a = generateApiKey()
    const b = generateApiKey()
    expect(a.startsWith('dmp_')).toBe(true)
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThan(32)
  })
})

describe('hashApiKey', () => {
  it('is deterministic and never returns the plaintext', () => {
    const key = generateApiKey()
    expect(hashApiKey(key)).toBe(hashApiKey(key))
    expect(hashApiKey(key)).not.toBe(key)
    expect(hashApiKey(key)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs for different keys', () => {
    expect(hashApiKey(generateApiKey())).not.toBe(hashApiKey(generateApiKey()))
  })
})
