import { z } from 'zod'

// Strings only: a non-string username would otherwise reach Prisma as a filter object.
export const loginBodySchema = z.object({
  username: z.string().min(1, 'is required'),
  password: z.string().min(1, 'is required'),
  // Absent means "remember"; only an explicit false downgrades to a session cookie.
  rememberMe: z.unknown().optional().transform(v => v !== false),
})

export const changePasswordBodySchema = z.object({
  currentPassword: z.string().min(1, 'is required'),
  newPassword: z.string().min(6, 'Password must be at least 6 characters'),
})
