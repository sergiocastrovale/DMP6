import type { H3Event } from 'h3'
import type { z } from 'zod'

export type FieldIssue = { path: string, message: string }

export const fieldIssues = (error: z.ZodError): FieldIssue[] =>
  error.issues.map(i => ({ path: i.path.join('.'), message: i.message }))

// One place that turns a schema failure into a 400 carrying the field list, so no route hand-rolls it
// and a malformed body is never a TypeError 500.
export const parseOr400 = <S extends z.ZodType>(schema: S, data: unknown): z.output<S> => {
  const result = schema.safeParse(data)
  if (!result.success) {
    const issues = fieldIssues(result.error)
    throw createError({
      statusCode: 400,
      statusMessage: issues[0] ? `Invalid request: ${issues[0].path || 'body'} ${issues[0].message}` : 'Invalid request',
      data: { issues },
    })
  }
  return result.data
}

// An empty body reads as undefined; schemas see `{}` so they can default it or name the missing field.
export const readBodyOf = async <S extends z.ZodType>(event: H3Event, schema: S): Promise<z.output<S>> =>
  parseOr400(schema, (await readBody(event).catch(() => undefined)) ?? {})

export const queryOf = <S extends z.ZodType>(event: H3Event, schema: S): z.output<S> =>
  parseOr400(schema, getQuery(event))
