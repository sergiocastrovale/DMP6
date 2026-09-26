import { z } from 'zod'
import { isValidEmail } from '~/server/utils/validation'

export const ROLES = ['VIEWER', 'MANAGER', 'ADMIN'] as const

const email = z.string().refine(isValidEmail, 'Invalid email')
const password = z.string().min(6, 'Password must be at least 6 characters')

export const createUserBodySchema = z.object({
  username: z.string().min(1, 'is required'),
  email,
  password,
  // An unknown role falls back to the least-privileged one rather than failing the whole request.
  role: z.unknown().optional().transform(v => (ROLES.find(r => r === v) ?? 'VIEWER')),
})

export const updateUserBodySchema = z.object({
  email: email.optional(),
  role: z.enum(ROLES).optional(),
  password: password.optional(),
})
