import { describe, it, expect } from 'vitest'
import { permissionsBodySchema } from '../../../server/schemas/permissions'
import { createApiKeyBodySchema } from '../../../server/schemas/apiKeys'

describe('permissionsBodySchema', () => {
  it('accepts known permissions for both editable roles', () => {
    const body = { matrix: { VIEWER: ['play.view'], MANAGER: ['play.view', 'sync.run'] } }
    expect(permissionsBodySchema.parse(body)).toEqual(body)
  })

  it('rejects an empty body, a missing role and an unknown permission', () => {
    expect(permissionsBodySchema.safeParse({}).success).toBe(false)
    expect(permissionsBodySchema.safeParse({ matrix: { VIEWER: [] } }).success).toBe(false)
    expect(permissionsBodySchema.safeParse({ matrix: { VIEWER: ['nope'], MANAGER: [] } }).success).toBe(false)
  })
})

describe('createApiKeyBodySchema', () => {
  it('trims and bounds the name', () => {
    expect(createApiKeyBodySchema.parse({ name: '  phone ' }).name).toBe('phone')
    expect(createApiKeyBodySchema.safeParse({ name: '   ' }).success).toBe(false)
    expect(createApiKeyBodySchema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false)
    expect(createApiKeyBodySchema.safeParse({}).success).toBe(false)
  })
})
