import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Settings forms save automatically (no Save button) - see components/settings/*Form.vue. Every
// text field saves on blur, every switch/select/checkbox saves on change. These specs exercise the
// real /api/settings PUT (against the disposable e2e DB, never production - see test:e2e's
// with-test-db wrapper) and assert the "Saved" status actually appears, catching both a broken
// autosave wiring and a hard client-side error (Nuxt shows a full-page error overlay on an uncaught
// exception, which every locator below would fail against).
const consoleErrors: string[] = []

test.beforeEach(({ page }) => {
  consoleErrors.length = 0
  page.on('pageerror', (err) => { consoleErrors.push(err.message) })
})

const gotoSettings = async (page: Page, section: string) => {
  await page.goto(`/settings/${section}`)
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible()
}

const expectSaved = async (page: Page) => {
  // Downloads settings has two Save bars (one per panel) - at least one shows "Saved".
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible()
}

test.describe('settings autosave', () => {
  test('library: text field saves on blur, switch saves on change', async ({ page }) => {
    await gotoSettings(page, 'library')

    const musicDir = page.getByLabel('Music Directory')
    await musicDir.fill('/tmp/e2e-music-dir')
    await musicDir.blur()
    await expectSaved(page)

    const putAfterSwitch = page.waitForResponse(r => r.url().includes('/api/settings') && r.request().method() === 'PUT')
    await page.getByRole('switch', { name: 'Show terminal sidebar' }).click()
    await putAfterSwitch
    await expectSaved(page)

    expect(consoleErrors).toEqual([])
  })

  test('downloads: invalid URL blocks save and shows an inline error', async ({ page }) => {
    await gotoSettings(page, 'downloads')

    const url = page.getByLabel('slskd URL')
    await url.fill('not-a-url')
    const putCount = { n: 0 }
    page.on('request', (r) => {
      if (r.url().includes('/api/settings') && r.method() === 'PUT') {putCount.n += 1}
    })
    await url.blur()
    await expect(page.getByText('Must be a valid http(s) URL')).toBeVisible()
    expect(putCount.n).toBe(0)

    await url.fill('http://localhost:5030')
    await url.blur()
    await expectSaved(page)

    expect(consoleErrors).toEqual([])
  })

  test('downloads: turning a switch off hides its own section, not the other', async ({ page }) => {
    await gotoSettings(page, 'downloads')

    await expect(page.getByLabel('slskd URL')).toBeVisible()
    await expect(page.getByLabel('Max concurrent downloads')).toBeVisible()

    await page.getByLabel('Downloads enabled').selectOption('off')
    await expectSaved(page)
    await expect(page.getByLabel('slskd URL')).toBeHidden()
    await expect(page.getByLabel('Max concurrent downloads')).toBeVisible()

    await page.getByLabel('Monitoring').selectOption('off')
    await expectSaved(page)
    await expect(page.getByLabel('Max concurrent downloads')).toBeHidden()

    expect(consoleErrors).toEqual([])
  })

  test('downloads: monitoring select saves on change', async ({ page }) => {
    await gotoSettings(page, 'downloads')

    await page.getByLabel('Monitoring').selectOption('on')
    await expectSaved(page)

    expect(consoleErrors).toEqual([])
  })

  test('downloads: Conversion select saves on change', async ({ page }) => {
    await gotoSettings(page, 'downloads')

    await page.getByLabel('Convert FLAC to MP3').selectOption('off')
    await expectSaved(page)

    expect(consoleErrors).toEqual([])
  })

  test('storage: S3 Endpoint validates and saves', async ({ page }) => {
    await gotoSettings(page, 'storage')

    const endpoint = page.getByLabel('S3 Endpoint')
    await endpoint.fill('ftp://bad-scheme')
    await endpoint.blur()
    await expect(page.getByText('Must be a valid http(s) URL')).toBeVisible()

    await endpoint.fill('https://s3.us-west-001.backblazeb2.com')
    await endpoint.blur()
    await expectSaved(page)

    const storageMode = page.getByLabel('Storage Mode')
    await storageMode.selectOption('s3')
    await expectSaved(page)

    expect(consoleErrors).toEqual([])
  })

  test('api-keys: fanart key saves on blur', async ({ page }) => {
    await gotoSettings(page, 'api-keys')

    const fanart = page.getByLabel('API Key').first()
    await fanart.fill('fanart-e2e-key')
    await fanart.blur()
    await expectSaved(page)

    expect(consoleErrors).toEqual([])
  })

  test('api-keys: Connect Last.fm saves the key first, then succeeds immediately', async ({ page }) => {
    // Regression test: connect() persists the API key via a PUT, then immediately calls
    // GET /api/scrobble/connect. That handler used to read the key back through
    // server/utils/settingsCache.ts (a 30s-TTL cache meant for hot paths like audio/image
    // serving), so this immediate read could still see the pre-save value - "Last.fm API key not
    // configured" even though the key had just been saved. connect.get.ts now reads the DB
    // directly instead.
    await gotoSettings(page, 'api-keys')

    // Block the external hop so the test never leaves localhost; connect() still runs our own
    // /api/scrobble/connect for real, which is what exercises the fix.
    await page.route('https://www.last.fm/**', route => route.fulfill({ status: 200, body: 'stubbed' }))

    const apiKey = page.getByLabel('API Key').nth(1)
    const secret = page.getByLabel('Shared Secret')
    await apiKey.fill('lastfm-e2e-key')
    await secret.fill('lastfm-e2e-secret')

    const connectResponse = page.waitForResponse(r => r.url().includes('/api/scrobble/connect'))
    await page.getByRole('button', { name: /Connect Last\.fm/ }).click()
    const resp = await connectResponse
    expect(resp.status()).toBe(200)

    await expect(page.getByText('Last.fm API key not configured')).not.toBeVisible()
    expect(consoleErrors).toEqual([])
  })

  test('permissions: toggling a checkbox saves immediately', async ({ page }) => {
    await gotoSettings(page, 'permissions')
    await expect(page.getByRole('row').nth(1)).toBeVisible()

    const putAfterToggle = page.waitForResponse(r => r.url().includes('/api/permissions') && r.request().method() === 'PUT')
    await page.locator('input[type="checkbox"]').first().click()
    await putAfterToggle
    await expectSaved(page)

    expect(consoleErrors).toEqual([])
  })
})
