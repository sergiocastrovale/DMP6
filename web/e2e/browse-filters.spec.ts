import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createReadyGuard, onlyId } from './helpers/fixtures'

// Browse's Filters button opens BrowseFiltersSidebar as a right-docked panel at lg+ and an
// ~90%-width/height dialog below it (both with a blurred scrim) - see docs/design_system.md and
// pages/browse.vue. Needs at least one artist with a genre and an owned release (browse's own
// `where` excludes credit-only artists) to exercise the genre checkbox end to end.

const prisma = new PrismaClient()
const { markReady, isReady } = createReadyGuard()

let artistId: string
let genreId: string
let genreName: string

const gotoBrowse = async (page: Page) => {
  await page.goto('/browse')
  await expect(page.getByRole('heading', { name: 'Browse' })).toBeVisible()
}

const openSidebar = async (page: Page) => {
  await gotoBrowse(page)
  await page.getByRole('button', { name: /^Filters\b/ }).click()
  await expect(page.getByRole('dialog', { name: 'Filters' })).toBeVisible()
}

test.beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8)
  genreName = `E2E Genre ${suffix}`

  const genre = await prisma.genre.create({ data: { name: genreName } })
  genreId = genre.id

  const artist = await prisma.artist.create({
    data: {
      name: `E2E Browse Filters Fixture ${suffix}`,
      slug: `e2e-browse-filters-fixture-${suffix}`,
      genres: { connect: { id: genreId } },
      // Artist.localReleases is the LocalReleaseArtist junction, not LocalRelease itself - the
      // owned release goes through a nested create on that join row.
      localReleases: {
        create: {
          localRelease: {
            create: {
              title: 'E2E Fixture Release',
              groupKey: `folder:e2e-browse-filters-${suffix}`,
            },
          },
        },
      },
    },
  })
  artistId = artist.id

  markReady()
})

test.afterAll(async () => {
  if (!isReady()) {
    await prisma.$disconnect()
    return
  }
  await prisma.artist.deleteMany({ where: onlyId(artistId) })
  await prisma.genre.deleteMany({ where: onlyId(genreId) })
  await prisma.$disconnect()
})

test.describe('browse filters', () => {
  test('the toolbar starts with no filter count and no "Clear" button', async ({ page }) => {
    await gotoBrowse(page)
    const filtersButton = page.getByRole('button', { name: /^Filters\b/ })
    await expect(filtersButton).toBeVisible()
    await expect(filtersButton).not.toContainText(/\d/)
    await expect(page.getByRole('button', { name: 'Clear' })).toHaveCount(0)
  })

  test('checking a genre in the sidebar updates the toolbar badge and re-queries the list', async ({ page }) => {
    await openSidebar(page)
    const reload = page.waitForResponse(resp => resp.url().includes('/api/artists') && resp.url().includes('genre='))
    await page.getByRole('checkbox', { name: new RegExp(genreName) }).check()
    await reload

    await expect(page.getByRole('button', { name: /^Filters\b/ })).toContainText('1')

    await page.getByRole('button', { name: 'Close' }).click()
    await expect(page.getByRole('dialog', { name: 'Filters' })).toBeHidden()
    await expect(page.getByRole('button', { name: 'Clear' })).toBeVisible()

    await page.getByRole('button', { name: 'Clear' }).click()
    await expect(page.getByRole('button', { name: /^Filters\b/ })).not.toContainText(/\d/)
  })

  test('sidebar is a right-docked panel at desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openSidebar(page)
    const panel = page.getByRole('dialog', { name: 'Filters' })
    const box = (await panel.boundingBox())!
    expect(box.x + box.width).toBeGreaterThan(1400) // docked flush against the right edge
    expect(box.width).toBeLessThan(500) // fixed-width panel, not a near-full-width dialog
  })

  test('sidebar is a centred, near-full-height dialog below lg width', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 })
    await openSidebar(page)
    const panel = page.getByRole('dialog', { name: 'Filters' })
    const box = (await panel.boundingBox())!
    expect(box.width).toBeLessThanOrEqual(320) // same fixed width as the desktop panel
    expect(Math.abs(box.x + box.width / 2 - 400)).toBeLessThan(2) // centred, not docked
    expect(box.height).toBeGreaterThan(900 * 0.85)
  })

  test('letter filters span the full row width at desktop size', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await gotoBrowse(page)
    const all = page.getByRole('button', { name: 'All', exact: true })
    const z = page.getByRole('button', { name: 'Z', exact: true })
    const allBox = (await all.boundingBox())!
    const zBox = (await z.boundingBox())!
    // The row fills its container width: "All" and "Z" sit far apart, one per equal-width column -
    // below lg (FilterLetter.test.ts) they'd instead wrap onto a tightly-packed multi-row block.
    expect(zBox.x + zBox.width - allBox.x).toBeGreaterThan(900)
  })
})
