import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { expect, test } from '@playwright/test'
import { createReadyGuard, waitForHydration } from './helpers/fixtures'

// The Downloads pages no longer poll the queue every couple of seconds: the server pushes a `changed` event over
// /api/downloads/events and the page re-reads. This drives it with two tabs - one watching the queue, the other making a
// change through the API - and checks the watching tab follows without doing anything itself. The safety-net poll is 60 s
// and the idle one 15 s, so a row that leaves within a few seconds can only have been pushed.

const prisma = new PrismaClient()
const { markReady, isReady } = createReadyGuard()

let fixtureId: string
let fixtureTitle: string

test.beforeAll(async () => {
  fixtureTitle = `E2E Push Fixture ${randomUUID().slice(0, 8)}`
  const row = await prisma.downloadedRelease.create({
    data: { title: fixtureTitle, year: 2022, status: 'FAILED', attempts: 2, error: 'e2e push fixture' },
  })
  fixtureId = row.id
  markReady()
})

test.afterAll(async () => {
  if (isReady()) {
    await prisma.downloadedRelease.deleteMany({ where: { id: fixtureId } })
  }
  await prisma.$disconnect()
})

test('a change made in another tab reaches an open Downloads page without it polling', async ({ page, context }) => {
  const streamOpened = page.waitForResponse(r => r.url().includes('/api/downloads/events'))
  await page.goto('/downloads/queue?filter=failed')
  await waitForHydration(page)
  await streamOpened
  await page.getByPlaceholder('Search queue…').fill(fixtureTitle)
  const row = page.locator('tr', { hasText: fixtureTitle })
  await expect(row).toBeVisible()

  const other = await context.newPage()
  const rejected = await other.request.post(`/api/downloads/reject/${fixtureId}`)
  expect(rejected.ok()).toBe(true)

  await expect(row).toHaveCount(0, { timeout: 5000 })
  await other.close()
})
