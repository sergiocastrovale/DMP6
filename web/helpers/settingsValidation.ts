import { z } from 'zod'

// Every settings text field is optional (blank = fall back to the env default), so each schema
// accepts '' alongside its real constraint rather than being wrapped in .optional() everywhere.
export const urlField = z.string().refine(
  v => v.trim() === '' || /^https?:\/\/.+/i.test(v.trim()),
  'Must be a valid http(s) URL',
)

export const positiveIntField = z.string().refine(
  v => v.trim() === '' || (/^\d+$/.test(v.trim()) && Number(v.trim()) > 0),
  'Must be a positive whole number',
)

export const absolutePathField = z.string().refine(
  v => v.trim() === '' || v.trim().startsWith('/'),
  'Must be an absolute path (starting with /)',
)

// Returns an error message, or '' when the value passes.
export const validateField = (schema: z.ZodType<string>, value: string): string => {
  const result = schema.safeParse(value)
  return result.success ? '' : (result.error.issues[0]?.message ?? 'Invalid value')
}
