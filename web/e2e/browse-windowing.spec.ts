import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createReadyGuard } from './helpers/fixtures'

// A long browse session keeps thousands of artists in the store; the expanded grid renders only the rows near the
// viewport (components/browse/ArtistGrid.vue, composables/useWindowedGrid.ts). Runs against the disposable e2e
// database: it seeds enough owned artists to pass the windowing threshold.

const prisma = new PrismaClient()
const { markReady } = createReadyGuard()

const SEEDED = 400
let suffix: string

test.beforeAll(async () => {
  suffix = randomUUID().slice(0, 6)
  for (let chunk = 0; chunk < SEEDED; chunk += 50) {
    await Promise.all(Array.from({ length: 50 }, (_, i) => {
      const n = chunk + i
      const label = String(n).padStart(4, '0')
      return prisma.artist.create({
        data: {
          name: `Window ${suffix} ${label}`,
          slug: `window-${suffix}-${label}`,
          localReleases: {
            create: { localRelease: { create: { title: `Window Album ${label}`, groupKey: `folder:window-${suffix}-${label}` } } },
          },
        },
      })
    }))
  }
  markReady()
})

// Read without waiting: the counter is absent while a page is loading.
const shown = (page: Page): Promise<{ loaded: number, total: number }> => page.evaluate(() => {
  const text = [...document.querySelectorAll('#main-content div')].map(d => (d.textContent ?? '').replace(/\s+/g, ' ').trim()).find(t => /^Showing \d+ of \d+ artists$/.test(t)) ?? ''
  const [, loaded, total] = /Showing (\d+) of (\d+)/.exec(text) ?? []
  return { loaded: Number(loaded ?? 0), total: Number(total ?? 0) }
})

const tileCount = (page: Page) => page.locator('#main-content a[href^="/artist/"]').count()

// Tiles whose box overlaps the visible part of the scroll container - a blank viewport would read 0.
const tilesInView = (page: Page) => page.evaluate(() => {
  const main = document.querySelector('#main-content')!.getBoundingClientRect()
  return [...document.querySelectorAll('#main-content a[href^="/artist/"]')].filter((a) => {
    const r = a.getBoundingClientRect()
    return r.bottom > main.top && r.top < main.bottom
  }).length
})

test('a long list keeps only the rows near the viewport in the DOM and never shows a blank gap', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/browse')
  await expect(page.getByRole('heading', { name: 'Browse' })).toBeVisible()
  const main = page.locator('#main-content')

  await expect(page.locator('#main-content a[href^="/artist/"]').first()).toBeVisible()

  // Scroll to the bottom until infinite scroll has pulled in every artist.
  await expect.poll(async () => {
    await main.evaluate(el => el.scrollTo(0, el.scrollHeight))
    const { loaded, total } = await shown(page)
    return loaded >= SEEDED && loaded === total
  }, { timeout: 30_000, intervals: [200] }).toBe(true)

  const { loaded } = await shown(page)
  await expect.poll(() => tileCount(page)).toBeLessThan(loaded / 2)
  expect(await tilesInView(page)).toBeGreaterThan(0)

  // Jump to the middle: the window follows and the viewport is still full of tiles.
  await main.evaluate(el => el.scrollTo(0, el.scrollHeight / 2))
  await expect.poll(() => tilesInView(page)).toBeGreaterThan(3)
  expect(await tileCount(page)).toBeLessThan(loaded / 2)
  if (process.env.SHOT_DIR) {
    await page.screenshot({ path: `${process.env.SHOT_DIR}/browse-windowed-middle.png` })
  }

  // Back to the top: the first artist is rendered again.
  await main.evaluate(el => el.scrollTo(0, 0))
  await expect.poll(() => tilesInView(page)).toBeGreaterThan(3)
  await expect(page.locator('#main-content a[href^="/artist/"]').first()).toBeVisible()
})
