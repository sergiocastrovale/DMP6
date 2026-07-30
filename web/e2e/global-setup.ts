import { mkdirSync } from 'node:fs'
import { request } from '@playwright/test'

// Logs in once and saves the cookie session for all specs. Credentials come from env so CI can
// inject the seeded test user (see web/prisma/seed.ts). The seed creates the user with
// mustChangePassword=true (blocks every page/API but the change-password one), so we clear it here
// by "changing" the password to itself - keeps this file the single source of a ready-to-use session
// whether or not the caller already cleared the flag (CI's web-tests.yml does this via a DB update).
export default async (): Promise<void> => {
  const baseURL = process.env.BASE_URL || 'http://localhost:3000'
  const username = process.env.TEST_USER || 'admin'
  const password = process.env.TEST_PASS || 'admin'
  const ctx = await request.newContext({ baseURL })
  const login = await ctx.post('/api/auth/login', { data: { username, password } })
  const { mustChangePassword } = await login.json()
  if (mustChangePassword) {
    await ctx.post('/api/auth/change-password', {
      data: { currentPassword: password, newPassword: password },
    })
  }
  mkdirSync('e2e/.auth', { recursive: true })
  await ctx.storageState({ path: 'e2e/.auth/state.json' })
  await ctx.dispose()
}
