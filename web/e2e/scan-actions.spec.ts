import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createReadyGuard, onlyId } from './helpers/fixtures'

// The scan buttons are the only UI that can mutate or destroy library data: they shell out to
// ./index, ./sync and ./delete. The library-wide "full re-scan" re-reads every tag
// (--overwrite-with-images); the artist rebuilds drop the artist's rows outright before re-indexing.
// What must never regress is the exact command line each button sends, and who is allowed to send it.
//
// So every test intercepts POST /api/terminal/run and answers with a canned SSE stream: the real
// endpoint spawns tmux + the release binaries against MUSIC_DIR, which would rewrite the machine's
// music library from a test run. The one test that deliberately hits the real endpoint is the
// permission check, which must reach the server to prove it 403s.

const prisma = new PrismaClient()
const { markReady, isReady } = createReadyGuard()

interface CapturedRun { command: string, args: string[] }

let artistName: string
let artistSlug: string
let artistId: string
let releaseId: string
let managerUsername: string
const managerPassword = 'e2e-manager-pass'

// Answers the SSE contract stores/terminal.ts expects: one output frame, then `event: done` carrying
// the exit code, so isRunning flips back to false and the next button click is not blocked.
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

// Both pages render server-side, so a button can be clickable before Vue has hydrated it - a click
// that lands in that window is silently swallowed and the run never happens. Each page fires exactly
// one client-only poll on mount, so waiting for that response is a precise hydration signal.
const gotoHydrated = async (page: Page, path: string, hydrationPoll: string) => {
  const hydrated = page.waitForResponse(hydrationPoll)
  await page.goto(path)
  await hydrated
}

const openArtistMenu = async (page: Page) => {
  await gotoHydrated(page, `/artist/${artistSlug}`, `**/api/artists/${artistSlug}/download-status`)
  await page.getByRole('button', { name: 'Scan catalogue' }).click()
  // Menu contents confirm the dropdown is open before any option is addressed.
  await expect(page.getByRole('button', { name: 'Scan for new files' })).toBeVisible()
}

const gotoLibrarySettings = async (page: Page) =>
  gotoHydrated(page, '/settings/library', '**/api/scan/status')

test.beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8)
  artistName = `E2E Scan Fixture ${suffix}`
  artistSlug = `e2e-scan-fixture-${suffix}`
  managerUsername = `e2e-manager-${suffix}`

  const artist = await prisma.artist.create({ data: { name: artistName, slug: artistSlug } })
  artistId = artist.id

  // folderPath is what artistScanFolders() turns into the `--only` scan root, so the fixture needs a
  // real local release + track for the dropdown to target anything but the artist name.
  const release = await prisma.localRelease.create({
    data: {
      title: 'E2E Scan Fixture Album',
      year: 2020,
      groupKey: `folder:${artistName}/Album`,
      folderPath: `${artistName}/Album`,
      artists: { create: { artistId } },
      tracks: {
        create: {
          title: 'E2E Scan Fixture Track',
          artist: artistName,
          albumArtist: artistName,
          album: 'E2E Scan Fixture Album',
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

test.describe('artist scan dropdown', () => {
  test('"Scan for new files" runs a scoped index+sync with no destructive flag', async ({ page }) => {
    const runs = await stubTerminal(page)
    await openArtistMenu(page)
    await page.getByRole('button', { name: 'Scan for new files' }).click()

    await expect.poll(() => runs).toEqual([
      { command: './index', args: ['--only', artistName, '--exact'] },
      { command: './sync', args: ['--only', artistName, '--exact'] },
    ])
  })

  // --y is load-bearing: ./delete prompts on stdin, and a tmux-backed run has nobody to answer it.
  test('"Rebuild everything" deletes, re-indexes and re-matches', async ({ page }) => {
    const runs = await stubTerminal(page)
    await openArtistMenu(page)
    await page.getByRole('button', { name: 'Rebuild everything' }).click()

    await expect.poll(() => runs).toEqual([
      { command: './delete', args: [artistName, '--y'] },
      { command: './index', args: ['--only', artistName, '--exact', '--overwrite'] },
      { command: './sync', args: ['--only', artistName, '--exact', '--overwrite'] },
    ])
  })

  test('"Rebuild from files only" stops before MusicBrainz', async ({ page }) => {
    const runs = await stubTerminal(page)
    await openArtistMenu(page)
    await page.getByRole('button', { name: 'Rebuild from files only' }).click()

    await expect.poll(() => runs).toEqual([
      { command: './delete', args: [artistName, '--y'] },
      { command: './index', args: ['--only', artistName, '--exact', '--overwrite'] },
    ])
  })

  test('"Re-match from scratch" touches MusicBrainz only', async ({ page }) => {
    const runs = await stubTerminal(page)
    await openArtistMenu(page)
    await page.getByRole('button', { name: 'Re-match from scratch' }).click()

    await expect.poll(() => runs).toEqual([
      { command: './sync', args: ['--only', artistName, '--exact', '--overwrite'] },
    ])
  })
})

test.describe('global scan grid (/settings/library)', () => {
  test('"Check for new files" runs an unscoped index+sync', async ({ page }) => {
    const runs = await stubTerminal(page)
    await gotoLibrarySettings(page)
    await page.getByRole('button', { name: 'Check for new files' }).click()

    await expect.poll(() => runs).toEqual([
      { command: './index', args: [] },
      { command: './sync', args: [] },
    ])
  })

  test('"Full re-scan" re-reads everything but never prunes library-wide', async ({ page }) => {
    const runs = await stubTerminal(page)
    await gotoLibrarySettings(page)
    await page.getByRole('button', { name: 'Full re-scan' }).click()

    await expect.poll(() => runs).toEqual([
      { command: './index', args: ['--overwrite-with-images'] },
      { command: './sync', args: ['--overwrite'] },
    ])
    // A half-mounted share during a whole-library pass is exactly what the ratio guard defends
    // against, so --prune stays a per-artist tool.
    expect(runs.flatMap(r => r.args)).not.toContain('--prune')
  })

  test('offers no per-artist rebuild', async ({ page }) => {
    await stubTerminal(page)
    await gotoLibrarySettings(page)
    await expect(page.getByRole('button', { name: 'Check for new files' })).toBeVisible()
    // The rebuilds delete an artist first; there is no library-wide equivalent behind this grid.
    await expect(page.getByRole('button', { name: 'Rebuild everything' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Rebuild from files only' })).toHaveCount(0)
  })
})

test.describe('manager (non-admin)', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  const loginAsManager = async (page: Page) => {
    await page.goto('/login')
    const submit = page.getByRole('button', { name: 'Sign in' })
    // Sign in only enables once v-model has both fields, so filling until it enables is the login
    // page's own hydration signal (a fill that lands pre-hydration never reaches the ref).
    await expect(async () => {
      await page.getByLabel('Username').fill(managerUsername)
      await page.getByLabel('Password').fill(managerPassword)
      await expect(submit).toBeEnabled({ timeout: 1000 })
    }).toPass()
    await submit.click()
    await page.waitForURL('/')
  }

  test('can run the normal scan but is never offered a rebuild', async ({ page }) => {
    const runs = await stubTerminal(page)
    await loginAsManager(page)
    await openArtistMenu(page)

    await expect(page.getByRole('button', { name: 'Rebuild everything' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Rebuild from files only' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Re-match from scratch' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Scan for new files' })).toBeVisible()

    await page.getByRole('button', { name: 'Scan for new files' }).click()
    await expect.poll(() => runs).toEqual([
      { command: './index', args: ['--only', artistName, '--exact'] },
      { command: './sync', args: ['--only', artistName, '--exact'] },
    ])
  })

  test('the server rejects a destructive run even if the request is forged', async ({ page }) => {
    // No terminal stub here on purpose: this one must reach the real endpoint. It is rejected before
    // anything is spawned, so no binary runs.
    await loginAsManager(page)
    const forged = await page.request.post('/api/terminal/run', {
      data: { command: './index', args: ['--only', artistName, '--exact', '--prune'], session: 'dmp-index' },
    })
    expect(forged.status()).toBe(403)
  })
})
