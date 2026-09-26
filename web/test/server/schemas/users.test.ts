import { describe, it, expect } from 'vitest'
import { createUserBodySchema, updateUserBodySchema } from '../../../server/schemas/users'

describe('createUserBodySchema', () => {
  const ok = { username: 'a', email: 'a@b.co', password: 'secret1' }

  it('defaults an absent or unknown role to VIEWER', () => {
    expect(createUserBodySchema.parse(ok).role).toBe('VIEWER')
    expect(createUserBodySchema.parse({ ...ok, role: 'ROOT' }).role).toBe('VIEWER')
    expect(createUserBodySchema.parse({ ...ok, role: 'MANAGER' }).role).toBe('MANAGER')
  })

  it('rejects an empty body, bad email and short password', () => {
    expect(createUserBodySchema.safeParse({}).success).toBe(false)
    expect(createUserBodySchema.safeParse({ ...ok, email: 'nope' }).success).toBe(false)
    expect(createUserBodySchema.safeParse({ ...ok, password: '123' }).success).toBe(false)
  })
})

describe('updateUserBodySchema', () => {
  it('accepts an empty object (route reports "no fields")', () => {
    expect(updateUserBodySchema.parse({})).toEqual({})
  })

  it('rejects unknown roles, bad email and short passwords', () => {
    expect(updateUserBodySchema.safeParse({ role: 'ROOT' }).success).toBe(false)
    expect(updateUserBodySchema.safeParse({ email: 'x' }).success).toBe(false)
    expect(updateUserBodySchema.safeParse({ password: '12345' }).success).toBe(false)
  })
})
