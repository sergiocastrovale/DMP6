import { PrismaClient } from '@prisma/client'
import { test } from '@playwright/test'

const prisma = new PrismaClient()
const OUT = process.env.SHOT_DIR

// Opt-in: this is a visual-check harness, not an assertion suite. It seeds fixtures and writes PNGs,
// so it only runs when a destination is given:
//
//   SHOT_DIR=/tmp/shots pnpm test:e2e e2e/capture.spec.ts --workers=1
//
// Then open the PNGs beside handoff/screenshots/ and compare. Screens change in ways no assertion
// catches - spacing, density, alignment, contrast - and this is the cheapest way to see that.
test.skip(!OUT, 'set SHOT_DIR to capture screenshots')

// Representative fixtures so the screenshots show real density - an empty state verifies nothing
// about spacing or rhythm. Seeded into the throwaway e2e database, never a real library.
const GENRES = ['rock', 'jazz', 'electronic', 'ambient', 'pop', 'indie rock', 'shoegaze', 'trip hop']
const NAMES = [
  'Boards of Canada', 'Radiohead', 'Aphex Twin', 'Portishead', 'Massive Attack',
  'Slowdive', 'My Bloody Valentine', 'Burial', 'Four Tet', 'Bonobo', 'Nils Frahm', 'Jon Hopkins',
  'Caribou', 'Mount Kimbie', 'Floating Points', 'Kelly Lee Owens', 'Tycho', 'Olafur Arnalds',
  '10,000 Maniacs', '070 Shake', 'Interpol', 'The National', 'Sigur Ros', 'Godspeed You Black Emperor',
]

test.beforeAll(async () => {
  for (const g of GENRES) {
    await prisma.genre.upsert({ where: { name: g }, create: { name: g }, update: {} })
  }

  for (let i = 0; i < NAMES.length; i++) {
    const name = NAMES[i]!
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `artist-${i}`
    const artist = await prisma.artist.create({
      data: {
        name,
        slug,
        totalTracks: 20 + i * 17,
        totalPlayCount: i * 93,
        averageMatchScore: Math.min(1, 0.35 + (i % 7) * 0.11),
        genres: { connect: [{ name: GENRES[i % GENRES.length]! }] },
      },
    })

    for (let r = 0; r < 1 + (i % 5); r++) {
      await prisma.localRelease.create({
        data: {
          title: `${name} Album ${r + 1}`,
          year: 1968 + ((i * 3 + r * 5) % 55),
          groupKey: `folder:${slug}/album-${r}`,
          folderPath: `${name}/Album ${r + 1}`,
          matchStatus: r % 3 === 0 ? 'COMPLETE' : r % 3 === 1 ? 'MISSING_TRACKS' : 'UNMATCHED',
          totalPlayCount: (i + r) * 12,
          artists: { create: { artistId: artist.id } },
          tracks: {
            create: Array.from({ length: 4 + (r % 5) }, (_, t) => ({
              title: `Track ${t + 1}`,
              artist: name,
              albumArtist: name,
              album: `${name} Album ${r + 1}`,
              trackNumber: t + 1,
              duration: 150 + t * 37,
              playCount: (t * (i + 1)) % 40,
              filePath: `${name}/Album ${r + 1}/0${t + 1}.mp3`,
            })),
          },
        },
      })
    }
  }

  await prisma.statistics.upsert({
    where: { id: 'main' },
    create: { id: 'main', mainArtists: NAMES.length },
    update: { mainArtists: NAMES.length },
  })
})

test.afterAll(async () => { await prisma.$disconnect() })

// Read-only. Terminal runs are stubbed defensively: a real one spawns the Rust binaries.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/terminal/run', route => route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    body: 'data: "stub"\n\nevent: done\ndata: 0\n\n',
  }))
  await page.setViewportSize({ width: 1600, height: 1100 })
})

const ROUTES: [string, string][] = [
  ['01-browse', '/browse'],
  ['03-explore', '/explore'],
  ['04-timeline', '/timeline'],
  ['05-playlists', '/playlists'],
  ['06-favorites', '/favorites'],
  ['07-statistics', '/statistics'],
  ['07-statistics_shortest', '/statistics/shortest'],
  ['08-settings', '/settings/library'],
  ['09-issues', '/issues'],
  ['10-downloads', '/downloads/monitoring'],
  ['11-labs', '/labs'],
  ['11-labs_decades', '/labs/decades'],
]

for (const [name, route] of ROUTES) {
  test(`shot ${name}`, async ({ page }) => {
    await page.goto(route)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${OUT!}/${name}.png` })
  })
}

test('shot 01-browse_list', async ({ page }) => {
  await page.goto('/browse')
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.getByTitle('List view').click().catch(() => {})
  await page.waitForTimeout(1500)
  await page.screenshot({ path: `${OUT!}/01-browse_list.png` })
})

test('shot 02-artist', async ({ page }) => {
  await page.goto('/artist/radiohead')
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(1200)
  await page.screenshot({ path: `${OUT!}/02-artist.png` })
})
