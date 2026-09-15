import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@prisma/client'
import { expect, test } from '@playwright/test'
import { createReadyGuard } from './helpers/fixtures'

// Statistics -> Release Types (pages/statistics/types/index.vue): one pivoted table, one column per
// bucket. Row click and the artist-name link both go to the artist; a nonzero count links to the
// type-detail page (pages/statistics/types/[bucket].vue) instead. a11y.spec.ts already covers that
// the index page itself has no violations.

const prisma = new PrismaClient()
const { markReady, isReady } = createReadyGuard()

// fullyParallel runs this file's tests in separate workers, each running beforeAll independently -
// two workers upserting the same global 'Album'/'EP' ReleaseType row race, and Prisma's upsert isn't
// atomic against that (the loser's own INSERT half throws P2002 instead of falling back to the
// update). Retry as a plain find-after-conflict instead.
const ensureReleaseType = async (name: string, slug: string) => {
  try {
    return await prisma.releaseType.create({ data: { name, slug } })
  }
  catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return await prisma.releaseType.findUniqueOrThrow({ where: { name } })
    }
    throw e
  }
}

let artistId: string
let artistName: string
let artistSlug: string
let albumReleaseId: string
let epReleaseId: string

test.beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8)
  artistName = `E2E Types Fixture ${suffix}`
  artistSlug = `e2e-types-fixture-${suffix}`

  const artist = await prisma.artist.create({ data: { name: artistName, slug: artistSlug } })
  artistId = artist.id

  const albumType = await ensureReleaseType('Album', 'album')
  const epType = await ensureReleaseType('EP', 'ep')

  const album = await prisma.musicBrainzRelease.create({
    data: { title: `E2E Album ${suffix}`, typeId: albumType.id, musicbrainzId: `e2e-mb-album-${suffix}`, mediumCount: 1 },
  })
  const ep = await prisma.musicBrainzRelease.create({
    data: { title: `E2E EP ${suffix}`, typeId: epType.id, musicbrainzId: `e2e-mb-ep-${suffix}`, mediumCount: 1 },
  })
  albumReleaseId = album.id
  epReleaseId = ep.id

  const localAlbum = await prisma.localRelease.create({ data: { title: album.title, releaseId: album.id, groupKey: `e2e-types-album-${suffix}` } })
  await prisma.localReleaseArtist.create({ data: { localReleaseId: localAlbum.id, artistId } })

  const localEp = await prisma.localRelease.create({ data: { title: ep.title, releaseId: ep.id, groupKey: `e2e-types-ep-${suffix}` } })
  await prisma.localReleaseArtist.create({ data: { localReleaseId: localEp.id, artistId } })

  markReady()
})

test.afterAll(async () => {
  if (!isReady()) {
    await prisma.$disconnect()
    return
  }
  await prisma.localReleaseArtist.deleteMany({ where: { artistId } })
  await prisma.localRelease.deleteMany({ where: { releaseId: { in: [albumReleaseId, epReleaseId].filter(Boolean) } } })
  await prisma.musicBrainzRelease.deleteMany({ where: { id: { in: [albumReleaseId, epReleaseId].filter(Boolean) } } })
  await prisma.artist.delete({ where: { id: artistId } }).catch(() => {})
  await prisma.$disconnect()
})

test('shows one row per artist with a count in each bucket column, and no actions column', async ({ page }) => {
  await page.goto('/statistics/types')
  await page.getByPlaceholder('Search artists...').fill(artistName)

  const row = page.locator('tr', { hasText: artistName })
  await expect(row).toBeVisible()

  const cells = row.locator('td')
  await expect(cells.nth(1)).toHaveText('1') // Albums
  await expect(cells.nth(2)).toHaveText('1') // EPs
  await expect(row.getByRole('button')).toHaveCount(0)
})

test('clicking anywhere on the row (a zero cell) opens the artist page', async ({ page }) => {
  await page.goto('/statistics/types')
  await page.getByPlaceholder('Search artists...').fill(artistName)
  const row = page.locator('tr', { hasText: artistName })

  // Live is one of this fixture's zero buckets - plain dimmed text, not its own link - so clicking
  // it only fires through the row-level handler, proving the whole row (not just the name cell) works.
  await row.locator('td').filter({ hasText: '0' }).first().click()
  await expect(page).toHaveURL(`/artist/${artistSlug}`)
})

test('clicking the artist name opens the artist page', async ({ page }) => {
  await page.goto('/statistics/types')
  await page.getByPlaceholder('Search artists...').fill(artistName)
  await page.getByRole('link', { name: artistName, exact: true }).click()
  await expect(page).toHaveURL(`/artist/${artistSlug}`)
})

test('clicking a nonzero count opens the type-detail page listing that artist\'s releases in that bucket', async ({ page }) => {
  await page.goto('/statistics/types')
  await page.getByPlaceholder('Search artists...').fill(artistName)
  const row = page.locator('tr', { hasText: artistName })

  await row.getByRole('link', { name: '1', exact: true }).first().click()
  await expect(page).toHaveURL(new RegExp(`/statistics/types/(album|ep)\\?artist=${artistSlug}`))
  await expect(page.locator('h1')).toContainText(artistName)
  await expect(page.locator('tr', { hasText: 'E2E' })).toBeVisible()
})

test('?sort=<bucket> query param sorts the table by that column on load', async ({ page }) => {
  await page.goto('/statistics/types?sort=ep')
  await expect(page.getByRole('columnheader', { name: /EPs/ })).toHaveAttribute('aria-sort', /ascending|descending/)
})
