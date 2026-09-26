import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { expect, test } from '@playwright/test'
import { createReadyGuard, waitForHydration } from './helpers/fixtures'

// The big pages (playlist detail, timeline, statistics, labs) were split into composables and components; this loads
// each against seeded data and fails on any uncaught page error or hydration warning, so a broken import or a lost
// binding in a refactor shows up here rather than in the browser. With SHOT_DIR set it also writes a screenshot per
// page for a visual comparison (see e2e/capture.spec.ts). The mosaic page is left out: its listing proxies to
// REMOTE_SERVER_URL when that is set in the environment.

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
]

for (const name of ['playlist-detail', 'timeline', 'statistics', 'labs-decades', 'labs-map', 'labs-network']) {
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
