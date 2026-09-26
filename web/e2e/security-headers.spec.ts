import { expect, test, type Page } from '@playwright/test'

// The production build ships a Content-Security-Policy (server/utils/securityHeaders.ts). A directive that is
// too tight doesn't crash anything - the browser just blocks the load and logs to the console - so this
// visits the main screens and fails on any CSP violation message.
const stubTerminal = async (page: Page) => {
  await page.route('**/api/terminal/run', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `data: ${JSON.stringify('e2e stub')}\n\nevent: done\ndata: 0\n\n`,
    })
  })
}

const ROUTES = ['/', '/browse', '/explore', '/timeline', '/playlists', '/favorites', '/labs', '/labs/map', '/labs/network', '/settings/library']

test.describe('security headers', () => {
  test('sends framing, sniffing and CSP headers', async ({ request }) => {
    const res = await request.get('/api/health')
    const headers = res.headers()
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['content-security-policy']).toContain('frame-ancestors \'none\'')
  })

  test('serves Inter Tight from this origin and makes no third-party requests', async ({ page, baseURL }) => {
    const external: string[] = []
    page.on('request', (req) => {
      const url = new URL(req.url())
      if (url.origin !== new URL(baseURL!).origin && !['data:', 'blob:'].includes(url.protocol)) {
        external.push(req.url())
      }
    })
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    const loaded = await page.evaluate(async () => {
      await document.fonts.ready
      return [...document.fonts].some(f => f.family.replace(/["']/g, '') === 'Inter Tight' && f.status === 'loaded')
    })
    expect(loaded).toBe(true)
    expect(external).toEqual([])
  })

  for (const route of ROUTES) {
    test(`${route} triggers no CSP violations`, async ({ page }) => {
      await stubTerminal(page)
      const violations: string[] = []
      page.on('console', (msg) => {
        if (/content security policy/i.test(msg.text())) {
          violations.push(msg.text())
        }
      })
      await page.goto(route)
      await page.waitForLoadState('networkidle')
      expect(violations).toEqual([])
    })
  }
})
