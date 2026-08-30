import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createReadyGuard, onlyId } from './helpers/fixtures'

// "Remove artist" is the only UI that can delete audio files from MUSIC_DIR (./delete --files). What
// must never regress: the checkbox is off by default, --files is sent ONLY when it is ticked, and a
// non-admin is neither offered the button nor able to forge the request.
//
// POST /api/terminal/run is stubbed in every test that clicks - the real endpoint spawns ./delete
// against the live library. The permission test deliberately hits the real endpoint, which rejects it
// before anything is spawned.

const prisma = new PrismaClient()
const { markReady, isReady } = createReadyGuard()

interface CapturedRun { command: string, args: string[] }

let artistName: string
let artistSlug: string
let artistId: string
let managerUsername: string
const managerPassword = 'e2e-manager-pass'

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

const gotoArtist = async (page: Page) => {
  const hydrated = page.waitForResponse(`**/api/artists/${artistSlug}/download-status`)
  await page.goto(`/artist/${artistSlug}`)
  await hydrated
}

const openDialog = async (page: Page) => {
  await gotoArtist(page)
  await page.getByRole('button', { name: 'Remove' }).click()
  await expect(page.getByText('Remove all files from this artist')).toBeVisible()
}

test.beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8)
  artistName = `E2E Delete Fixture ${suffix}`
  artistSlug = `e2e-delete-fixture-${suffix}`
  managerUsername = `e2e-del-manager-${suffix}`

  const artist = await prisma.artist.create({ data: { name: artistName, slug: artistSlug } })
  artistId = artist.id

  await prisma.user.create({
    data: {
      username: managerUsername,
      email: `${managerUsername}@local`,
      passwordHash: await bcrypt.hash(managerPassword, 12),
      role: 'MANAGER',
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
  await prisma.user.deleteMany({ where: { username: managerUsername || '__never_matches__' } })
  await prisma.$disconnect()
})

test.describe('artist removal', () => {
  test('deletes the catalogue only, with the file opt-in left alone', async ({ page }) => {
    const runs = await stubTerminal(page)
    await openDialog(page)
    await page.getByRole('button', { name: 'Remove from catalogue' }).click()

    await expect.poll(() => runs).toEqual([
      { command: './delete', args: [artistName, '--y'] },
    ])
    await page.waitForURL('/browse')
  })

  test('sends --files only after the opt-in is switched on', async ({ page }) => {
    const runs = await stubTerminal(page)
    await openDialog(page)
    await page.getByRole('switch', { name: 'Remove all files from this artist' }).click()
    await page.getByRole('button', { name: 'Delete artist and files' }).click()

    await expect.poll(() => runs).toEqual([
      { command: './delete', args: [artistName, '--y', '--files'] },
    ])
  })
})

test.describe('manager (non-admin)', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  const loginAsManager = async (page: Page) => {
    await page.goto('/login')
    const submit = page.getByRole('button', { name: 'Sign in' })
    await expect(async () => {
      await page.getByLabel('Username').fill(managerUsername)
      await page.getByLabel('Password').fill(managerPassword)
      await expect(submit).toBeEnabled({ timeout: 1000 })
    }).toPass()
    await submit.click()
    await page.waitForURL('/')
  }

  test('is never offered the removal button', async ({ page }) => {
    await stubTerminal(page)
    await loginAsManager(page)
    await gotoArtist(page)
    await expect(page.getByRole('button', { name: 'Remove' })).toHaveCount(0)
  })

  test('the server rejects a forged ./delete run', async ({ page }) => {
    await loginAsManager(page)
    const forged = await page.request.post('/api/terminal/run', {
      data: { command: './delete', args: [artistName, '--y', '--files'], session: 'dmp-delete' },
    })
    expect(forged.status()).toBe(403)
  })
})
