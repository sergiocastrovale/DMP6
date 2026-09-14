import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { CapturedRun } from '~/types/scan'
import { createReadyGuard, onlyId } from './helpers/fixtures'

// "Remove this release" (release info dialog -> trash) is the only UI that can delete a SINGLE
// release's files from MUSIC_DIR (./delete --release <id> --files). What must never regress: the
// dialog is a second dialog stacked over the release info dialog (Escape closes only the top one),
// the file opt-in checkbox is off by default, --files is sent ONLY when it is ticked, and a
// non-admin is neither offered the trash icon nor able to forge the request.
//
// POST /api/terminal/run is stubbed in every test that clicks - the real endpoint spawns ./delete
// against the live library. The permission test deliberately hits the real endpoint, which rejects it
// before anything is spawned.

const prisma = new PrismaClient()
const { markReady, isReady } = createReadyGuard()

let artistName: string
let artistSlug: string
let artistId: string
let releaseId: string
let releaseTitle: string
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

// The releases list itself is fetched server-side (useFetch during SSR) and arrives already embedded
// in the initial HTML/payload, so there is no separate client XHR to wait on for it - only
// download-status is a client-only post-hydration poll, the same hydration signal artist-delete.spec.ts
// uses.
const gotoArtist = async (page: Page) => {
  const hydrated = page.waitForResponse(`**/api/artists/${artistSlug}/download-status`)
  await page.goto(`/artist/${artistSlug}`)
  await hydrated
}

const openReleaseInfo = async (page: Page) => {
  await gotoArtist(page)
  await page.getByRole('button', { name: 'Release info' }).click()
  await expect(page.getByRole('heading', { name: releaseTitle })).toBeVisible()
}

const openDeleteDialog = async (page: Page) => {
  await openReleaseInfo(page)
  await page.getByRole('button', { name: 'Remove this release' }).click()
  await expect(page.getByText('Remove the actual files from disk')).toBeVisible()
}

test.beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8)
  artistName = `E2E Release Delete Fixture ${suffix}`
  artistSlug = `e2e-release-delete-fixture-${suffix}`
  releaseTitle = 'E2E Release Delete Fixture Album'
  managerUsername = `e2e-reldel-manager-${suffix}`

  const artist = await prisma.artist.create({ data: { name: artistName, slug: artistSlug } })
  artistId = artist.id

  const release = await prisma.localRelease.create({
    data: {
      title: releaseTitle,
      year: 2020,
      groupKey: `folder:${artistName}/Album`,
      folderPath: `${artistName}/Album`,
      artists: { create: { artistId } },
      tracks: {
        create: {
          title: 'E2E Release Delete Fixture Track',
          artist: artistName,
          albumArtist: artistName,
          album: releaseTitle,
          filePath: `${artistName}/Album/01.mp3`,
        },
      },
    },
  })
  releaseId = release.id

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
  await prisma.localRelease.deleteMany({ where: onlyId(releaseId) })
  await prisma.artist.deleteMany({ where: onlyId(artistId) })
  await prisma.user.deleteMany({ where: { username: managerUsername || '__never_matches__' } })
  await prisma.$disconnect()
})

test.describe('release removal', () => {
  test('is a dialog stacked over release info - Escape closes only the confirm dialog', async ({ page }) => {
    await stubTerminal(page)
    await openDeleteDialog(page)

    await page.keyboard.press('Escape')
    await expect(page.getByText('Remove the actual files from disk')).not.toBeVisible()
    // The release info dialog underneath must still be open.
    await expect(page.getByRole('heading', { name: releaseTitle })).toBeVisible()
  })

  test('removes the release only, with the file opt-in left alone', async ({ page }) => {
    const runs = await stubTerminal(page)
    await openDeleteDialog(page)
    await page.getByRole('button', { name: 'Remove from catalogue' }).click()

    await expect.poll(() => runs).toEqual([
      { command: './delete', args: ['--release', releaseId, '--y'] },
    ])
  })

  test('sends --files only after the opt-in is switched on', async ({ page }) => {
    const runs = await stubTerminal(page)
    await openDeleteDialog(page)
    await page.getByRole('switch', { name: 'Remove the actual files from disk' }).click()
    await page.getByRole('button', { name: 'Delete release and files' }).click()

    await expect.poll(() => runs).toEqual([
      { command: './delete', args: ['--release', releaseId, '--y', '--files'] },
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
      await page.getByLabel('Password', { exact: true }).fill(managerPassword)
      await expect(submit).toBeEnabled({ timeout: 1000 })
    }).toPass()
    await submit.click()
    await page.waitForURL('/')
  }

  test('is never offered the removal trash icon', async ({ page }) => {
    await stubTerminal(page)
    await loginAsManager(page)
    await openReleaseInfo(page)
    await expect(page.getByRole('button', { name: 'Remove this release' })).toHaveCount(0)
  })

  test('the server rejects a forged ./delete --release run', async ({ page }) => {
    await loginAsManager(page)
    const forged = await page.request.post('/api/terminal/run', {
      data: { command: './delete', args: ['--release', releaseId, '--y', '--files'], session: 'delete-release-forged' },
    })
    expect(forged.status()).toBe(403)
  })
})
