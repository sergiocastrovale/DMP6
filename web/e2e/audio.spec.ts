import { expect, request, test } from '@playwright/test'

// End-to-end coverage of the streaming contract that the unit tests (web/test/audioRange.test.ts)
// cover at the unit level - here exercised through the real Nitro handler + auth.

const randomTrackId = async (page: import('@playwright/test').Page): Promise<string | null> => {
  return page.evaluate(async () => {
    const t = await fetch('/api/tracks/random').then(r => r.json()).catch(() => null)
    return t?.id ?? null
  })
}

test('Range request returns 206 with Content-Range', async ({ page }) => {
  await page.goto('/')
  const id = await randomTrackId(page)
  test.skip(!id, 'no tracks seeded')

  const res = await page.request.get(`/api/audio/${id}`, { headers: { Range: 'bytes=0-99' } })
  expect(res.status()).toBe(206)
  const headers = res.headers()
  expect(headers['content-range']).toMatch(/^bytes 0-99\/\d+$/)
  expect(headers['accept-ranges']).toBe('bytes')
  expect(headers['content-length']).toBe('100')
})

test('matching If-None-Match returns 304', async ({ page }) => {
  await page.goto('/')
  const id = await randomTrackId(page)
  test.skip(!id, 'no tracks seeded')

  const first = await page.request.get(`/api/audio/${id}`, { headers: { Range: 'bytes=0-0' } })
  const etag = first.headers().etag
  expect(etag).toBeTruthy()

  const cond = await page.request.get(`/api/audio/${id}`, { headers: { 'If-None-Match': etag ?? '' } })
  expect(cond.status()).toBe(304)
})

test('unauthenticated audio request is rejected with 401', async ({ baseURL }) => {
  // Empty storageState explicitly: a bare newContext() inherits the config's admin session, which
  // turned this into an authenticated request that 404s on the missing track instead of 401ing.
  const ctx = await request.newContext({ baseURL, storageState: { cookies: [], origins: [] } })
  const res = await ctx.get('/api/audio/any-id')
  expect(res.status()).toBe(401)
  await ctx.dispose()
})
