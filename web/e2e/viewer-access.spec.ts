import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createReadyGuard, onlyId } from './helpers/fixtures'

// A VIEWER (neither ADMIN nor MANAGER) gets no downloads and no scans: not the page, not its API, not
// the artist page's Monitor/Scan buttons - under the default permission matrix the test DB is seeded
// with (shared/permissionsMatrix.ts). An admin can still grant them from Settings → Permissions.

const prisma = new PrismaClient()
const { markReady, isReady } = createReadyGuard()

let artistId: string
let artistSlug: string
let viewerUsername: string
const viewerPassword = 'e2e-viewer-pass'

test.use({ storageState: { cookies: [], origins: [] } })

const loginAsViewer = async (page: Page) => {
  await page.goto('/login')
  const submit = page.getByRole('button', { name: 'Sign in' })
  await expect(async () => {
    await page.getByLabel('Username').fill(viewerUsername)
    await page.getByLabel('Password', { exact: true }).fill(viewerPassword)
    await expect(submit).toBeEnabled({ timeout: 1000 })
  }).toPass()
  await submit.click()
  await page.waitForURL('/')
}

test.beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8)
  artistSlug = `e2e-viewer-fixture-${suffix}`
  viewerUsername = `e2e-viewer-${suffix}`

  const artist = await prisma.artist.create({ data: { name: `E2E Viewer Fixture ${suffix}`, slug: artistSlug } })
  artistId = artist.id

  await prisma.user.create({
    data: {
      username: viewerUsername,
      email: `${viewerUsername}@local`,
      passwordHash: await bcrypt.hash(viewerPassword, 12),
      role: 'VIEWER',
      mustChangePassword: false,
    },
  })

  markReady()
})

test.afterAll(async () => {
  if (!isReady()) {
    await prisma.$disconnect()
    return
  }
  await prisma.artist.deleteMany({ where: onlyId(artistId) })
  await prisma.user.deleteMany({ where: { username: viewerUsername || '__never_matches__' } })
  await prisma.$disconnect()
})

test('the downloads page redirects home and is not in the sidebar', async ({ page }) => {
  await loginAsViewer(page)
  await expect(page.getByRole('link', { name: 'Downloads' })).toHaveCount(0)
  await page.goto('/downloads/queue')
  await page.waitForURL('/')
})

test('downloads, monitoring and scan endpoints all refuse a viewer', async ({ page }) => {
  await loginAsViewer(page)
  const gets = ['/api/downloads/queue', '/api/downloads/enabled', '/api/artists/monitoring', `/api/artists/${artistSlug}/download-status`]
  for (const url of gets) {
    expect((await page.request.get(url)).status(), url).toBe(403)
  }
  const patch = await page.request.patch(`/api/artists/${artistSlug}`, { data: { monitored: true } })
  expect(patch.status()).toBe(403)
  // Rejected on the permission check, before anything is spawned.
  const run = await page.request.post('/api/terminal/run', {
    data: { command: './index', args: ['--folders', 'nothing'], session: 'dmp-index' },
  })
  expect(run.status()).toBe(403)
})

test('the artist page offers neither Monitor nor Scan', async ({ page }) => {
  await loginAsViewer(page)
  await page.goto(`/artist/${artistSlug}`)
  await expect(page.getByRole('button', { name: 'Play all' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Monitor (ON|OFF)/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Scan' })).toHaveCount(0)
})
