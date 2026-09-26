import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { createError } from 'h3'

;(globalThis as Record<string, unknown>).createError = createError

const { parseOr400, fieldIssues } = await import('../../../server/utils/requestValidation')

const schema = z.object({ name: z.string().min(1), n: z.number().optional() })

describe('parseOr400', () => {
  it('returns the parsed value', () => {
    expect(parseOr400(schema, { name: 'a' })).toEqual({ name: 'a' })
  })

  it('throws a 400 naming the field', () => {
    try {
      parseOr400(schema, { name: '' })
      expect.unreachable()
    }
    catch (e) {
      const err = e as { statusCode: number, statusMessage: string, data: { issues: { path: string }[] } }
      expect(err.statusCode).toBe(400)
      expect(err.statusMessage).toContain('name')
      expect(err.data.issues[0]?.path).toBe('name')
    }
  })

  it('treats an empty body as missing fields, not a crash', () => {
    expect(() => parseOr400(schema, {})).toThrow(expect.objectContaining({ statusCode: 400 }))
  })
})

describe('fieldIssues', () => {
  it('joins nested paths', () => {
    const r = z.object({ a: z.object({ b: z.string() }) }).safeParse({ a: {} })
    expect(r.success).toBe(false)
    expect(!r.success && fieldIssues(r.error)[0]?.path).toBe('a.b')
  })
})
