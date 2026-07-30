import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { defineVitestProject } from '@nuxt/test-utils/config'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: [
        '.nuxt/**',
        '.output/**',
        'types/**',
        'prisma/**',
        'e2e/**',
        '**/*.config.ts',
        'test/**',
      ],
      // Baselined to the actual coverage after the initial test-writing pass (see docs/PLAN_tests.md
      // Phases 1-4: pure utils/helpers/composables are near-100%, but pages/most components/many
      // server routes are still untested). Ratchet these up as more of the plan's phases land -
      // don't lower them to make a future regression pass.
      thresholds: {
        lines: 60,
        functions: 50,
        statements: 60,
        branches: 45,
      },
    },
    projects: [
      {
        resolve: { alias: { '~': root, '@': root } },
        test: {
          name: 'unit',
          environment: 'happy-dom',
          include: ['test/helpers/**/*.test.ts', 'test/server/utils/**/*.test.ts', 'test/unit/**/*.test.ts'],
          setupFiles: ['test/setup/h3-globals.ts'],
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          environment: 'nuxt',
          include: ['test/stores/**/*.test.ts', 'test/composables/**/*.test.ts', 'test/components/**/*.test.ts'],
          setupFiles: ['test/setup/localstorage-shim.ts'],
        },
      }),
      {
        resolve: { alias: { '~': root, '@': root } },
        test: {
          name: 'integration',
          environment: 'node',
          include: ['test/integration/**/*.test.ts'],
          globalSetup: ['test/setup/db.global.ts'],
          setupFiles: ['test/setup/h3-globals.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
})
