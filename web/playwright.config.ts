import { config as loadEnv } from 'dotenv'
import { defineConfig, devices } from '@playwright/test'

// A non-default port avoids colliding with whatever else happens to be bound to :3000 on a dev
// machine - `reuseExistingServer` (local runs) silently adopts any server already on the port,
// which previously made the suite log in against an unrelated app and fail on its HTML response.
const port = process.env.PORT || '3300'
const baseURL = process.env.BASE_URL || `http://localhost:${port}`

// `node .output/server/index.mjs` is a plain Node process: unlike `nuxt dev` and vitest, nothing
// reads `.env` for it, so a local run started with no DATABASE_URL and no SESSION_SECRET. The server
// booted, every request 500'd on Prisma, and all fifteen data-driven specs failed as bare 30s
// locator timeouts that read like flakes rather than a missing variable.
//
// `override: false` is the important half: CI exports the real values for its own ephemeral
// database, and those must win over whatever a developer happens to have in `.env`.
loadEnv({ override: false })

// A fixed value keeps sessions stable across restarts of the suite; the production check in
// server/utils/auth.ts only requires that one exists.
const serverEnv = {
  ...(process.env as Record<string, string>),
  SESSION_SECRET: process.env.SESSION_SECRET || 'e2e-session-secret-fixed-for-determinism',
  PORT: port,
}

// Runs against the PRODUCTION build (the service worker only exists in `pnpm build` output -
// devOptions.enabled is false). CI builds, seeds a test DB, starts `node .output/server/index.mjs`.
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL,
    storageState: 'e2e/.auth/state.json',
    trace: 'on-first-retry',
  },
  webServer: process.env.PW_NO_SERVER
    ? undefined
    : {
        command: 'node .output/server/index.mjs',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: serverEnv,
      },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
