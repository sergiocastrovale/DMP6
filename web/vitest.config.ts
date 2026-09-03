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
          // Disables the app-manifest outdated-build poller: it schedules a real (non-fake) timer that
          // can fire after a later test file's Nuxt app has already torn down $fetch, throwing an
          // uncaught "Cannot read properties of undefined (reading 'catch')" that fails the whole run
          // even though every test passed.
          environmentOptions: { nuxt: { overrides: { experimental: { appManifest: false } } } },
          include: ['test/stores/**/*.test.ts', 'test/composables/**/*.test.ts', 'test/components/**/*.test.ts'],
          setupFiles: ['test/setup/localstorage-shim.ts', 'test/setup/auto-unmount.ts'],
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
