import { expect, test } from '@playwright/test'

// A thin end-to-end smoke test of the /rest/* Subsonic API dispatcher (server/routes/rest/
// [...path].ts) - the one layer unit/integration tests can't reach, since they call the endpoint
// functions directly rather than going over real HTTP (auth extraction from query params, the
// subsonic-response envelope, XML vs f=json content negotiation, HTTP-200-even-on-failure).

test.describe('rest api smoke', () => {
  test('ping/getArtists round-trip with a real API key, both JSON and XML, plus auth/error shapes', async ({ page, request, baseURL }) => {
    await page.goto('/settings/subsonic')
    await page.getByRole('button', { name: 'New Key' }).click()
    await page.getByLabel('Name').fill(`smoke test ${Date.now()}`)
    await page.getByRole('button', { name: 'Create' }).click()
    const key = (await page.locator('code', { hasText: 'dmp_' }).textContent())!.trim()
    await page.getByRole('button', { name: 'Done' }).click()

    const pingJson = await request.get(`${baseURL}/rest/ping.view?apiKey=${key}&f=json`)
    expect(pingJson.status()).toBe(200)
    const pingBody = await pingJson.json()
    expect(pingBody['subsonic-response']).toMatchObject({ status: 'ok', openSubsonic: true })

    const pingXml = await request.get(`${baseURL}/rest/ping.view?apiKey=${key}`)
    expect(pingXml.headers()['content-type']).toContain('text/xml')
    const xmlText = await pingXml.text()
    expect(xmlText).toContain('<subsonic-response')
    expect(xmlText).toContain('status="ok"')

    const artists = await request.get(`${baseURL}/rest/getArtists?apiKey=${key}&f=json`)
    expect(artists.status()).toBe(200)
    const artistsBody = await artists.json()
    expect(artistsBody['subsonic-response'].status).toBe('ok')
    expect(artistsBody['subsonic-response'].artists).toHaveProperty('index')

    // A missing/bad apiKey is still HTTP 200 - the failure lives in the envelope, never the status line.
    const bad = await request.get(`${baseURL}/rest/ping.view?apiKey=dmp_not-real&f=json`)
    expect(bad.status()).toBe(200)
    const badBody = await bad.json()
    expect(badBody['subsonic-response']).toMatchObject({ status: 'failed', error: { code: 44 } })

    // u/p/t auth is refused outright (code 42), never silently treated as anonymous.
    const legacy = await request.get(`${baseURL}/rest/ping.view?u=admin&p=admin&v=1.16.1&c=smoke&f=json`)
    const legacyBody = await legacy.json()
    expect(legacyBody['subsonic-response'].error.code).toBe(42)

    // An unknown endpoint name is a clean generic error, not a 404/crash.
    const unknown = await request.get(`${baseURL}/rest/notARealEndpoint?apiKey=${key}&f=json`)
    expect(unknown.status()).toBe(200)
    expect((await unknown.json())['subsonic-response'].status).toBe('failed')
  })
})
