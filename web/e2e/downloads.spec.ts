import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { expect, test } from '@playwright/test'
import { createReadyGuard } from './helpers/fixtures'

// End-to-end coverage of the downloads queue lifecycle (audit item 12): reject and "move back to
// queue" (requeue) are pure DB-state transitions with no external-service dependency, so they're
// reasonable to drive through the REAL UI end-to-end. Merge is deliberately NOT covered here — it
// shells out to the real index/sync binaries against MUSIC_DIR, which the integration suite
// (web/test/integration/downloads/promote.test.ts) already covers with a mocked reconciler; doing that
// for real in e2e would need a live MUSIC_DIR + built binaries and add nothing this suite can assert
// better than the integration tests already do.

const prisma = new PrismaClient()
const { markReady, isReady } = createReadyGuard()

// Default maxDownloadAttempts is 3 (Settings.maxDownloadAttempts / MAX_DOWNLOAD_ATTEMPTS), same
// assumption web/test/integration/downloads/promote.test.ts makes — attempts=2 -> one more reject
// crosses the cap into REJECTED (terminal) instead of bouncing back to FAILED (retryable).
const REJECT_CAP_ATTEMPTS = 2

let failedFixtureId: string
let failedFixtureTitle: string
let rejectedFixtureId: string
let rejectedFixtureTitle: string

test.beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8)
  failedFixtureTitle = `E2E Failed Fixture ${suffix}`
  rejectedFixtureTitle = `E2E Rejected Fixture ${suffix}`

  const failed = await prisma.downloadedRelease.create({
    data: { title: failedFixtureTitle, year: 2020, source: 'SLSKD', status: 'FAILED', attempts: REJECT_CAP_ATTEMPTS, error: 'e2e fixture' },
  })
  failedFixtureId = failed.id

  const rejected = await prisma.downloadedRelease.create({
    data: { title: rejectedFixtureTitle, year: 2021, source: 'SLSKD', status: 'REJECTED', attempts: 3, error: 'rejected by user' },
  })
  rejectedFixtureId = rejected.id

  markReady()
})

test.afterAll(async () => {
  if (!isReady()) {
    await prisma.$disconnect()
    return
  }
  // Explicitly filtered, not a bare [failedFixtureId, rejectedFixtureId]: an unassigned id would
  // put a literal `undefined` in the array, and this file's own history is why nothing here trusts
  // that Prisma treats that as "matches nothing" without being proven so first - see helpers/fixtures.ts.
  await prisma.downloadedRelease.deleteMany({ where: { id: { in: [failedFixtureId, rejectedFixtureId].filter(Boolean) } } })
  await prisma.$disconnect()
})

test('reject on the Failed tab crosses the attempts cap and the row moves to Rejected', async ({ page }) => {
  await page.goto('/downloads/failed')
  await page.getByPlaceholder('Search failed…').fill(failedFixtureTitle)

  const row = page.locator('tr', { hasText: failedFixtureTitle })
  await expect(row).toBeVisible()

  await row.getByRole('button', { name: 'Reject' }).click()
  await page.getByRole('button', { name: 'Reject & delete' }).click()

  await expect(row).toHaveCount(0)

  await page.goto('/downloads/rejected')
  await page.getByPlaceholder('Search rejected…').fill(failedFixtureTitle)
  await expect(page.locator('tr', { hasText: failedFixtureTitle })).toBeVisible()

  const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: failedFixtureId } })
  expect(after.status).toBe('REJECTED')
})

test('"Move back to queue" on the Rejected tab returns the row to Failed', async ({ page }) => {
  await page.goto('/downloads/rejected')
  await page.getByPlaceholder('Search rejected…').fill(rejectedFixtureTitle)

  const row = page.locator('tr', { hasText: rejectedFixtureTitle })
  await expect(row).toBeVisible()

  await row.getByRole('button', { name: 'Move back to queue' }).click()

  await expect(row).toHaveCount(0)

  await page.goto('/downloads/failed')
  await page.getByPlaceholder('Search failed…').fill(rejectedFixtureTitle)
  await expect(page.locator('tr', { hasText: rejectedFixtureTitle })).toBeVisible()

  const after = await prisma.downloadedRelease.findUniqueOrThrow({ where: { id: rejectedFixtureId } })
  expect(after.status).toBe('FAILED')
  expect(after.attempts).toBe(0)
})
