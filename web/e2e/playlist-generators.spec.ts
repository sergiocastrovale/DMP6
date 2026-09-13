import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { CapturedRun } from '~/types/scan'

// /playlists/setup/generated is the only UI that can trigger ./playlists (via the Generate/
// Regenerate button), so every test stubs POST /api/terminal/run rather than shelling out for real.
const stubTerminal = async (page: Page): Promise<CapturedRun[]> => {
  const runs: CapturedRun[] = []
  await page.route('**/api/terminal/run', async (route) => {
    const body = route.request().postDataJSON() as CapturedRun
    runs.push({ command: body.command, args: body.args })
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify('e2e stub')}\n\nevent: done\ndata: 0\n\n`,
    })
  })
  return runs
}

const prisma = new PrismaClient()

let rockName: string
let rockSlug: string
let rockId: string

test.beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8)
  rockName = `E2E Rock ${suffix}`
  rockSlug = `e2e-rock-${suffix}`
  const generator = await prisma.playlistGenerator.create({
    data: { type: 'GENRE', name: rockName, slug: rockSlug, terms: ['rock', 'grunge', '-indie rock'] },
  })
  rockId = generator.id
})

test.afterAll(async () => {
  await prisma.playlistGenerator.deleteMany({ where: { id: rockId } })
  await prisma.$disconnect()
})

test('lists seeded generators and offers Generate when none have run yet', async ({ page }) => {
  await stubTerminal(page)
  await page.goto('/playlists/setup/generated')

  await expect(page.getByRole('link', { name: rockName })).toBeVisible()
  await expect(page.getByRole('button', { name: /generate playlists/i })).toBeVisible()
})

test('editing a generator\'s terms persists', async ({ page }) => {
  await stubTerminal(page)
  await page.goto('/playlists/setup/generated')
  await page.getByRole('link', { name: rockName }).click()
  await expect(page).toHaveURL(`/playlists/setup/generated/${rockId}`)

  const textarea = page.locator('textarea').nth(1)
  await textarea.fill('rock\ngrunge\nbritpop\n-indie rock')
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page).toHaveURL('/playlists/setup/generated')

  const updated = await prisma.playlistGenerator.findUniqueOrThrow({ where: { id: rockId } })
  expect(updated.terms).toEqual(['rock', 'grunge', 'britpop', '-indie rock'])
})

test('adding a new generator shows it in the table', async ({ page }) => {
  await stubTerminal(page)
  const name = `E2E Japan ${randomUUID().slice(0, 8)}`

  await page.goto('/playlists/setup/generated/new')
  await page.getByLabel('Type').selectOption('REGION')
  await page.getByLabel('Name').fill(name)
  const termsField = page.locator('textarea').nth(1)
  await termsField.fill('JP\nKR')
  await page.getByRole('button', { name: 'Save' }).click()

  await expect(page).toHaveURL('/playlists/setup/generated')
  await expect(page.getByRole('link', { name })).toBeVisible()

  await prisma.playlistGenerator.deleteMany({ where: { name } })
})

test('removing a generator deletes it (and cascades its generated playlist)', async ({ page }) => {
  await stubTerminal(page)
  const name = `E2E Doomed ${randomUUID().slice(0, 8)}`
  const slug = `e2e-doomed-${randomUUID().slice(0, 8)}`
  const generator = await prisma.playlistGenerator.create({
    data: { type: 'GENRE', name, slug, terms: ['doom'] },
  })
  const playlist = await prisma.playlist.create({
    data: { type: 'GENRE', name, slug: `genre-${slug}`, generatorId: generator.id },
  })

  await page.goto('/playlists/setup/generated')
  const row = page.locator('tr', { has: page.getByRole('link', { name }) })
  await row.getByRole('button', { name: `Remove ${name}` }).click()
  await page.getByRole('button', { name: 'Remove', exact: true }).click()

  await expect(page.getByRole('link', { name })).toHaveCount(0)
  expect(await prisma.playlistGenerator.findUnique({ where: { id: generator.id } })).toBeNull()
  expect(await prisma.playlist.findUnique({ where: { id: playlist.id } })).toBeNull()
})

test('clicking Generate/Regenerate runs ./playlists', async ({ page }) => {
  const runs = await stubTerminal(page)
  await page.goto('/playlists/setup/generated')

  await page.getByRole('button', { name: /generate playlists/i }).click()

  await expect.poll(() => runs.map(r => r.command)).toContain('./playlists')
})
