import { expect, request, test } from '@playwright/test'

test('manifest is served with the expected PWA fields', async ({ page }) => {
  const res = await page.request.get('/manifest.webmanifest')
  expect(res.ok()).toBeTruthy()
  const manifest = await res.json()
  expect(manifest.name).toBe('DMP')
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons.length).toBeGreaterThan(0)
})

test('service worker registers and controls the page', async ({ page }) => {
  await page.goto('/')
  const active = await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) {
      return false
    }
    const reg = await navigator.serviceWorker.ready
    return !!reg.active
  })
  expect(active).toBeTruthy()
})

test('service worker never caches /api responses (the critical denylist guard)', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 30_000 })

  // Exercise an API call and an image through the SW.
  await page.evaluate(async () => {
    await fetch('/api/tracks/random').catch(() => {})
    await fetch('/img/favicon-32x32.png').catch(() => {})
  })

  const audit = await page.evaluate(async () => {
    let apiCached = false
    for (const name of await caches.keys()) {
      const cache = await caches.open(name)
      for (const req of await cache.keys()) {
        if (new URL(req.url).pathname.startsWith('/api/')) {
          apiCached = true
        }
      }
    }
    return { apiCached }
  })

  expect(audit.apiCached).toBe(false)
})
