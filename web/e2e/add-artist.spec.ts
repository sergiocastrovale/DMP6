import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createReadyGuard, onlyId } from './helpers/fixtures'

// /add runs the same class of mutating command as the scan buttons (see scan-actions.spec.ts) - it
// creates a folder under MUSIC_DIR and an Artist row via `./add`. Every test intercepts
// POST /api/terminal/run and the MusicBrainz routes so no real binary runs and no real MB call is made.

const prisma = new PrismaClient()
const { markReady, isReady } = createReadyGuard()

let existingArtistName: string
let existingArtistSlug: string
let existingArtistId: string
let viewerUsername: string

const mbid = randomUUID()

const stubTerminal = async (page: Page, exitCode = 0) => {
  const runs: Array<{ command: string, args: string[] }> = []
  await page.route('**/api/terminal/run', async (route) => {
    const body = route.request().postDataJSON()
    runs.push({ command: body.command, args: body.args })
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify('e2e stub')}\n\nevent: done\ndata: ${exitCode}\n\n`,
    })
  })
  return runs
}

const stubMbSearch = async (page: Page, name: string, existing: { slug: string, name: string } | null = null) => {
  await page.route('**/api/artists/mb-search*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items: [{ mbid, name, disambiguation: null, country: 'GB', type: 'Group', existing }] }),
    })
  })
}

test.beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8)
  existingArtistName = `E2E Add Fixture ${suffix}`
  existingArtistSlug = `e2e-add-fixture-${suffix}`
  viewerUsername = `e2e-add-viewer-${suffix}`

  const artist = await prisma.artist.create({ data: { name: existingArtistName, slug: existingArtistSlug } })
  existingArtistId = artist.id

  await prisma.user.create({
    data: {
      username: viewerUsername,
      email: `${viewerUsername}@local`,
      passwordHash: await bcrypt.hash('e2e-viewer-pass', 12),
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
  await prisma.artist.deleteMany({ where: onlyId(existingArtistId) })
  await prisma.user.deleteMany({ where: { username: viewerUsername || '__never_matches__' } })
  await prisma.$disconnect()
})

test('admin sees the Add artist button on /browse, leading to /add', async ({ page }) => {
  await page.goto('/browse')
  const button = page.getByRole('link', { name: 'Add artist' })
  await expect(button).toBeVisible()
  await button.click()
  await page.waitForURL('/add')
  await expect(page.getByRole('heading', { name: 'Add artist' })).toBeVisible()
})

test('searching and adding a new artist runs ./add and lands on its page', async ({ page }) => {
  const runs = await stubTerminal(page)
  const newSlug = `e2e-added-${randomUUID().slice(0, 8)}`
  await stubMbSearch(page, 'E2E New Artist')
  await page.route(`**/api/artists/by-mbid/${mbid}`, async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ message: 'Not found' }) })
  })
  await page.route(`**/api/artists/added/${mbid}`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ slug: newSlug }) })
  })

  await page.goto('/add')
  await page.getByPlaceholder('Artist name...').fill('E2E New Artist')
  await page.getByRole('button', { name: 'Search in MusicBrainz' }).click()
  await expect(page.getByText('E2E New Artist')).toBeVisible()

  await page.getByRole('button', { name: 'Add' }).click()

  await expect.poll(() => runs).toEqual([{ command: './add', args: ['--mbid', mbid] }])
  await page.waitForURL(`/artist/${newSlug}`)
})

test('adding an already-in-library artist shows the dialog, no terminal run', async ({ page }) => {
  const runs = await stubTerminal(page)
  await stubMbSearch(page, existingArtistName)
  await page.route(`**/api/artists/by-mbid/${mbid}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ slug: existingArtistSlug, name: existingArtistName }),
    })
  })

  await page.goto('/add')
  await page.getByPlaceholder('Artist name...').fill(existingArtistName)
  await page.getByRole('button', { name: 'Search in MusicBrainz' }).click()
  await expect(page.getByText(existingArtistName)).toBeVisible()

  await page.getByRole('button', { name: 'Add' }).click()

  await expect(page.getByRole('dialog')).toContainText('already in your library')
  await expect.poll(() => runs).toEqual([])
})

test('a row already flagged existing by mb-search shows no Add button', async ({ page }) => {
  const runs = await stubTerminal(page)
  await stubMbSearch(page, existingArtistName, { slug: existingArtistSlug, name: existingArtistName })

  await page.goto('/add')
  await page.getByPlaceholder('Artist name...').fill(existingArtistName)
  await page.getByRole('button', { name: 'Search in MusicBrainz' }).click()
  await expect(page.getByText(existingArtistName)).toBeVisible()

  await expect(page.getByRole('button', { name: 'Add' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'In library' })).toBeVisible()
  expect(runs).toEqual([])
})

test.describe('viewer (no sync.run)', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('has no Add artist button and is redirected away from /add', async ({ page }) => {
    await page.goto('/login')
    const submit = page.getByRole('button', { name: 'Sign in' })
    await expect(async () => {
      await page.getByLabel('Username').fill(viewerUsername)
      await page.getByLabel('Password', { exact: true }).fill('e2e-viewer-pass')
      await expect(submit).toBeEnabled({ timeout: 1000 })
    }).toPass()
    await submit.click()
    await page.waitForURL('/')

    await page.goto('/browse')
    await expect(page.getByRole('link', { name: 'Add artist' })).toHaveCount(0)

    await page.goto('/add')
    await page.waitForURL('/')
  })
})
