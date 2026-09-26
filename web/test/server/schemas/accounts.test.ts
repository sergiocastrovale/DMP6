import { describe, it, expect } from 'vitest'
import { loginBodySchema, changePasswordBodySchema } from '../../../server/schemas/auth'
import { monitorArtistBodySchema, monitorSelectedBodySchema } from '../../../server/schemas/artists'
import { presenceBodySchema } from '../../../server/schemas/presence'
import { createGeneratorBodySchema, updateGeneratorBodySchema } from '../../../server/schemas/playlistGenerators'

describe('loginBodySchema', () => {
  it('remembers unless rememberMe is explicitly false', () => {
    expect(loginBodySchema.parse({ username: 'a', password: 'b' }).rememberMe).toBe(true)
    expect(loginBodySchema.parse({ username: 'a', password: 'b', rememberMe: false }).rememberMe).toBe(false)
  })

  it('rejects an empty body and non-string credentials', () => {
    expect(loginBodySchema.safeParse({}).success).toBe(false)
    expect(loginBodySchema.safeParse({ username: { contains: '' }, password: 'b' }).success).toBe(false)
    expect(loginBodySchema.safeParse({ username: 'a', password: 1 }).success).toBe(false)
  })
})

describe('changePasswordBodySchema', () => {
  it('needs both fields and a 6+ char new password', () => {
    expect(changePasswordBodySchema.safeParse({}).success).toBe(false)
    expect(changePasswordBodySchema.safeParse({ currentPassword: 'a', newPassword: '12345' }).success).toBe(false)
    expect(changePasswordBodySchema.safeParse({ currentPassword: 'a', newPassword: '123456' }).success).toBe(true)
  })
})

describe('artist monitoring schemas', () => {
  it('needs a real boolean and, for bulk, a non-empty id list', () => {
    expect(monitorArtistBodySchema.safeParse({ monitored: 'yes' }).success).toBe(false)
    expect(monitorSelectedBodySchema.parse({ monitored: true, ids: ['a'] })).toEqual({ monitored: true, ids: ['a'] })
    expect(monitorSelectedBodySchema.safeParse({ monitored: true, ids: [] }).success).toBe(false)
    expect(monitorSelectedBodySchema.safeParse({ monitored: true }).success).toBe(false)
  })
})

describe('presenceBodySchema', () => {
  it('needs a clientId; trackId may be null', () => {
    expect(presenceBodySchema.safeParse({}).success).toBe(false)
    expect(presenceBodySchema.parse({ clientId: 'c', trackId: null, playing: true }).trackId).toBeNull()
  })
})

describe('playlist generator schemas', () => {
  it('normalises name, description and terms (array or newline text)', () => {
    const a = createGeneratorBodySchema.parse({ type: 'GENRE', name: '  Rock ', description: '  ', terms: ['rock', 'Rock', ' punk '] })
    expect(a).toEqual({ type: 'GENRE', name: 'Rock', description: null, terms: ['rock', 'punk'] })
    expect(updateGeneratorBodySchema.parse({ name: 'x', terms: 'a\nb\n' }).terms).toEqual(['a', 'b'])
  })

  it('defaults missing fields so validateGenerator can name the problem; create needs a known type', () => {
    expect(updateGeneratorBodySchema.parse({})).toEqual({ name: '', description: null, terms: [] })
    expect(createGeneratorBodySchema.safeParse({ name: 'x' }).success).toBe(false)
    expect(createGeneratorBodySchema.safeParse({ type: 'MANUAL', name: 'x' }).success).toBe(false)
  })
})
