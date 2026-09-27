import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { CapturedRun } from '~/types/scan'
import { createReadyGuard, waitForHydration } from './helpers/fixtures'

// Two artists, one name (docs/sync_decisions.md "Two artists, one name"): the bare slug is a chooser, each artist has
// its own `<name>-<id>` page that points at the other, an artist's old slug still lands on it, and a release can be
// moved to the other artist ("Assign to artist" -> ./fix --assign-artist, stubbed here - the real endpoint would
// rewrite files in MUSIC_DIR).
//
// The rows are written the way the scripts leave them (scripts/common/src/homonyms.rs): suffixed slugs, shared
// baseSlug. Seeding bypasses the library-version cache key, so the version is bumped and the 5s TTL waited out.

const prisma = new PrismaClient()
const { markReady, isReady } = createReadyGuard()

const PT_MBID = randomUUID()
const KR_MBID = randomUUID()
let name: string
let base: string
let ptSlug: string
let krSlug: string
let releaseTitle: string
let releaseId: string

const stubTerminal = async (page: Page): Promise<CapturedRun[]> => {
  const runs: CapturedRun[] = []
  await page.route('**/api/terminal/run', async (route) => {
    const body = route.request().postDataJSON() as CapturedRun
    runs.push({ command: body.command, args: body.args })
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: `data: ${JSON.stringify('e2e stub')}\n\nevent: done\ndata: 0\n\n` })
  })
  return runs
}

test.beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8)
  name = `E2E Napa ${suffix}`
  base = `e2e-napa-${suffix}`
  ptSlug = `${base}-${PT_MBID.replace(/-/g, '').slice(0, 8)}`
  krSlug = `${base}-${KR_MBID.replace(/-/g, '').slice(0, 8)}`
  releaseTitle = `E2E Homonym Album ${suffix}`

  const pt = await prisma.artist.create({
    data: { name, slug: ptSlug, baseSlug: base, musicbrainzId: PT_MBID, country: 'PT', disambiguation: 'Portuguese band' },
  })
  await prisma.artist.create({ data: { name, slug: krSlug, baseSlug: base, musicbrainzId: KR_MBID, country: 'KR' } })
  await prisma.artistSlugHistory.create({ data: { oldSlug: `${base}-old`, artistId: pt.id } })
  const release = await prisma.localRelease.create({
    data: {
      title: releaseTitle,
      year: 2020,
      groupKey: `folder:${name}/Album`,
      folderPath: `${name}/Album`,
      artists: { create: { artistId: pt.id } },
      tracks: { create: { title: 'Track', artist: name, albumArtist: name, album: releaseTitle, filePath: `${name}/Album/01.mp3` } },
    },
  })
  releaseId = release.id
  await prisma.statistics.upsert({ where: { id: 'main' }, create: { id: 'main' }, update: { updatedAt: new Date() } })
  await new Promise(resolve => setTimeout(resolve, 5500))
  markReady()
})

test.afterAll(async () => {
  if (isReady()) {
    await prisma.localRelease.deleteMany({ where: { id: releaseId } })
    await prisma.artist.deleteMany({ where: { baseSlug: base } })
  }
  await prisma.$disconnect()
})

test('the bare slug of a shared name is a chooser that leads to each artist', async ({ page }) => {
  await page.goto(`/artist/${base}`)
  await waitForHydration(page)
  await expect(page.getByText(`2 artists in your library are called ${name}`)).toBeVisible()
  await expect(page.getByText('Portuguese band · Portugal')).toBeVisible()
  await expect(page.getByText('South Korea')).toBeVisible()

  await page.getByRole('link', { name: 'South Korea' }).first().click()
  await expect(page).toHaveURL(new RegExp(`/artist/${krSlug}$`))
  await expect(page.getByRole('heading', { name, level: 1 }).first()).toBeVisible()
})

test('an artist page says which one it is and links the other', async ({ page }) => {
  await page.goto(`/artist/${ptSlug}`)
  await waitForHydration(page)
  await expect(page.getByText('Portuguese band · Portugal').first()).toBeVisible()
  const chip = page.getByRole('link', { name: /South Korea/ }).first()
  await expect(chip).toBeVisible()
  await chip.click()
  await expect(page).toHaveURL(new RegExp(`/artist/${krSlug}$`))
})

test('an old slug lands on the artist\'s current page', async ({ page }) => {
  await page.goto(`/artist/${base}-old`)
  await expect(page).toHaveURL(new RegExp(`/artist/${ptSlug}$`))
})

test('"Assign to artist" re-tags the release for the other artist and re-syncs it', async ({ page }) => {
  const runs = await stubTerminal(page)
  const hydrated = page.waitForResponse(`**/api/artists/${ptSlug}/download-status`)
  await page.goto(`/artist/${ptSlug}`)
  await hydrated
  await page.getByRole('button', { name: 'Release info' }).click()
  await expect(page.getByRole('heading', { name: releaseTitle })).toBeVisible()

  await page.getByRole('button', { name: 'South Korea' }).click()

  await expect.poll(() => runs.length).toBe(2)
  expect(runs[0]).toEqual({ command: './fix', args: ['--assign-artist', '--release', releaseId, '--mbid', KR_MBID] })
  expect(runs[1]).toEqual({ command: './refresh', args: ['--release', releaseId] })
})
