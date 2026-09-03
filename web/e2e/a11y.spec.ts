import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// Every spec here must stay read-only: a real click reaching /api/terminal/run would run the Rust
// binaries against MUSIC_DIR on whatever database web/.env points at. Stubbed defensively even
// though none of these routes trigger a scan on load.
const stubTerminal = async (page: Page) => {
  await page.route('**/api/terminal/run', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify('e2e stub')}\n\nevent: done\ndata: 0\n\n`,
    })
  })
}

// Vue/Nuxt hydration mismatches surface as console warnings/errors containing "hydration" - this
// is the actual signal for "the server-rendered markup didn't match the client's first render",
// not just any red text in the console (a 404 for a missing avatar image is noisy but harmless).
const watchForHydrationWarnings = (page: Page): string[] => {
  const warnings: string[] = []
  page.on('console', (msg) => {
    if (/hydration/i.test(msg.text())) {
      warnings.push(msg.text())
    }
  })
  return warnings
}

const runAxe = (page: Page) =>
  new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    // Nuxt DevTools' own overlay (unrelated to the shipped app UI, not something this overhaul
    // touches) renders inside this custom element regardless of build mode in this environment.
    .exclude('nuxt-devtools-frame')
    .analyze()

// One page per top-level section - not literally every route (many are per-item detail pages with
// no fixed slug, or thin variations of an already-covered layout), but enough to catch a systemic
// issue in any shared chrome (sidebar, topbar, dialogs) and in each section's own primary screen.
const AUTHENTICATED_ROUTES = [
  '/',
  '/browse',
  '/explore',
  '/timeline',
  '/playlists',
  '/favorites',
  '/downloads/monitoring',
  '/downloads/events',
  '/statistics',
  '/issues',
  '/labs',
  '/labs/decades',
  '/settings/library',
  '/settings/themes',
]

for (const route of AUTHENTICATED_ROUTES) {
  test(`${route} has no serious/critical a11y violations or hydration mismatches`, async ({ page }) => {
    await stubTerminal(page)
    const hydrationWarnings = watchForHydrationWarnings(page)
    await page.goto(route)
    await page.waitForLoadState('networkidle')

    const results = await runAxe(page)
    const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([])
    expect(hydrationWarnings).toEqual([])
  })
}

test.describe('unauthenticated', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('/login has no serious/critical a11y violations or hydration mismatches', async ({ page }) => {
    const hydrationWarnings = watchForHydrationWarnings(page)
    await page.goto('/login')
    await page.waitForLoadState('networkidle')

    const results = await runAxe(page)
    const serious = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([])
    expect(hydrationWarnings).toEqual([])
  })
})
