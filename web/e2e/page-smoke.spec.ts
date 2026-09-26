import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { expect, test } from '@playwright/test'
import { createReadyGuard, waitForHydration } from './helpers/fixtures'

// The big pages (playlist detail, timeline, statistics, labs) were split into composables and components; this loads
// each against seeded data and fails on any uncaught page error or hydration warning, so a broken import or a lost
// binding in a refactor shows up here rather than in the browser. With SHOT_DIR set it also writes a screenshot per
// page for a visual comparison (see e2e/capture.spec.ts). The mosaic page needs the app built without
// REMOTE_SERVER_URL (`REMOTE_SERVER_URL= pnpm build`), otherwise its listing proxies to that server.

const prisma = new PrismaClient()
const { markReady } = createReadyGuard()
const SHOTS = process.env.SHOT_DIR

let playlistSlug: string

test.beforeAll(async () => {
  const suffix = randomUUID().slice(0, 6)
  const artist = await prisma.artist.create({
    data: {
      name: `Smoke Artist ${suffix}`,
      slug: `smoke-artist-${suffix}`,
      country: 'PT',
      localReleases: {
        create: {
          localRelease: {
            create: {
              title: `Smoke Album ${suffix}`,
              year: 1994,
              groupKey: `folder:smoke-${suffix}`,
              tracks: { create: [{ title: 'Smoke Track One', filePath: `/smoke/${suffix}/1.flac`, trackNumber: 1, duration: 180 }] },
            },
          },
        },
      },
    },
    select: { localReleases: { select: { localRelease: { select: { tracks: { select: { id: true } } } } } } },
  })
  const trackId = artist.localReleases[0]!.localRelease.tracks[0]!.id
  const admin = await prisma.user.findFirstOrThrow({ where: { username: 'admin' }, select: { id: true } })
  playlistSlug = `smoke-playlist-${suffix}`
  await prisma.playlist.create({
    data: {
      name: `Smoke Playlist ${suffix}`,
      slug: playlistSlug,
      type: 'MANUAL',
      userId: admin.id,
      description: 'Seeded for the page smoke test',
      tracks: { create: { trackId, position: 0 } },
    },
  })
  markReady()
})

const routes = (): [string, string, RegExp][] => [
  ['playlist-detail', `/playlists/${playlistSlug}`, /Smoke Playlist/],
  ['timeline', '/timeline', /Timeline/],
  ['statistics', '/statistics', /Statistics/],
  ['labs-decades', '/labs/decades', /Decade/i],
  ['labs-map', '/labs/map', /Back to Labs/],
  ['labs-network', '/labs/network', /Network|Collaborat/i],
  ['labs-mosaic', '/labs/mosaic', /Album Mosaic/],
]

for (const name of ['playlist-detail', 'timeline', 'statistics', 'labs-decades', 'labs-map', 'labs-network', 'labs-mosaic']) {
  test(`${name} loads without page errors`, async ({ page }) => {
    const [, path, heading] = routes().find(r => r[0] === name)!
    const problems: string[] = []
    page.on('pageerror', err => problems.push(`pageerror: ${err.message}`))
    page.on('console', (msg) => {
      if (msg.type() === 'error' || /hydration/i.test(msg.text())) {
        // Map tiles and other third-party fetches fail offline; they are not the app's errors.
        if (!/Failed to load resource|tile\.openstreetmap|ERR_/i.test(msg.text())) {
          problems.push(`console: ${msg.text()}`)
        }
      }
    })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto(path)
    await waitForHydration(page)
    await expect(page.locator('body')).toContainText(heading, { timeout: 15_000 })
    await page.waitForTimeout(800)
    if (SHOTS) {
      await page.screenshot({ path: `${SHOTS}/smoke-${name}.png` })
    }
    expect(problems).toEqual([])
  })
}

// The world map end to end with stubbed data: a country with cover art gets its mosaic as a fill, and clicking it
// opens the artists list. (No image files exist in the test database, so the cover requests are answered by a stub.)
const RED_PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

test('the world map paints a country with its covers and opens its artists on click', async ({ page }) => {
  await page.route('**/api/labs/map/countries', route => route.fulfill({
    json: { PT: { name: 'Portugal', count: 2, images: [{ image: 'cover-a.png', imageUrl: null }, { image: 'cover-b.png', imageUrl: null }] } },
  }))
  await page.route('**/img/releases/cover-*.png', route => route.fulfill({ contentType: 'image/png', body: RED_PIXEL }))
  await page.route('**/api/labs/map/artists**', route => route.fulfill({
    json: { items: [{ id: 'a1', name: 'Map Artist One', slug: 'map-artist-one', image: null, imageUrl: null }], total: 1, page: 1, pageSize: 50, hasMore: false },
  }))
  await page.setViewportSize({ width: 1440, height: 1000 })
  // Navigate client-side: on a full page load useFetch would use the server-rendered payload and never ask the stub.
  await page.goto('/labs')
  await waitForHydration(page)
  await page.evaluate(() => (window as unknown as { useNuxtApp: () => { $router: { push: (to: string) => void } } }).useNuxtApp().$router.push('/labs/map'))

  const filled = page.locator('path[fill="url(#pat-PT)"]')
  await expect(filled).toHaveCount(1, { timeout: 15_000 })
  await expect(page.getByText('Showing 2 artists from 1 countries')).toBeVisible()

  await filled.dispatchEvent('click')
  await expect(page.getByRole('dialog')).toContainText('Portugal (2)')
  await expect(page.getByRole('dialog')).toContainText('Map Artist One')
})
