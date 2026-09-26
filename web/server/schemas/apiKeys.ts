import { z } from 'zod'

export const MAX_API_KEY_NAME_LEN = 100

export const createApiKeyBodySchema = z.object({
  name: z.string().trim().min(1, 'must be 1-100 characters').max(MAX_API_KEY_NAME_LEN, 'must be 1-100 characters'),
})
