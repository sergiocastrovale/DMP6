import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.BASE_URL || 'http://localhost:3000'

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
      },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
