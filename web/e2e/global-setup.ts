import { mkdirSync } from 'node:fs'
import { request } from '@playwright/test'

// Logs in once and saves the cookie session for all specs. Credentials come from env so CI can
// inject the seeded test user (see web/prisma/seed.ts).
export default async (): Promise<void> => {
  const baseURL = process.env.BASE_URL || 'http://localhost:3000'
  const ctx = await request.newContext({ baseURL })
  await ctx.post('/api/auth/login', {
    data: {
      username: process.env.TEST_USER || 'admin',
      password: process.env.TEST_PASS || 'admin',
    },
  })
  mkdirSync('e2e/.auth', { recursive: true })
  await ctx.storageState({ path: 'e2e/.auth/state.json' })
  await ctx.dispose()
}
