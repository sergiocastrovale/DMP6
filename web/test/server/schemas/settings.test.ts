import { describe, it, expect } from 'vitest'
import { settingsBodySchema } from '../../../server/schemas/settings'

describe('settingsBodySchema', () => {
  it('accepts an empty body and changes nothing', () => {
    const out = settingsBodySchema.parse({})
    expect(Object.values(out).every(v => v === undefined)).toBe(true)
  })

  it('keeps a real 0 and clears null/blank integers', () => {
    const out = settingsBodySchema.parse({ monitorCap: 0, retryCooldownDays: null, noProgressSec: '' })
    expect(out.monitorCap).toBe(0)
    expect(out.retryCooldownDays).toBeNull()
    expect(out.noProgressSec).toBeNull()
  })

  it('rejects a non-numeric integer', () => {
    const r = settingsBodySchema.safeParse({ monitorCap: 'abc' })
    expect(r.success).toBe(false)
    expect(!r.success && r.error.issues[0]?.path).toEqual(['monitorCap'])
  })

  it('treats null booleans as a clear and non-booleans as invalid', () => {
    expect(settingsBodySchema.parse({ downloadsEnabled: null }).downloadsEnabled).toBeNull()
    expect(settingsBodySchema.parse({ downloadsEnabled: false }).downloadsEnabled).toBe(false)
    expect(settingsBodySchema.safeParse({ downloadsEnabled: 'yes' }).success).toBe(false)
  })

  it('leaves a blank secret untouched and clears on null', () => {
    expect(settingsBodySchema.parse({ slskdApiKey: '' }).slskdApiKey).toBeUndefined()
    expect(settingsBodySchema.parse({ slskdApiKey: null }).slskdApiKey).toBeNull()
    expect(settingsBodySchema.parse({ slskdApiKey: 'k' }).slskdApiKey).toBe('k')
  })

  it('validates urls and the absolute music dir but allows blanks', () => {
    expect(settingsBodySchema.safeParse({ slskdUrl: 'not a url' }).success).toBe(false)
    expect(settingsBodySchema.safeParse({ musicDir: 'relative/dir' }).success).toBe(false)
    expect(settingsBodySchema.parse({ slskdUrl: '', musicDir: '/music' }).musicDir).toBe('/music')
  })

  it('rejects non-string text and strips unknown keys', () => {
    expect(settingsBodySchema.safeParse({ awsRegion: 5 }).success).toBe(false)
    expect(settingsBodySchema.parse({ id: 'other', awsRegion: 'eu' })).not.toHaveProperty('id')
  })
})
