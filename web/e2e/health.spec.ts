import { expect, test } from '@playwright/test'

// Public probes: a bare flag, no details (see server/api/health.get.ts).
test('the shallow probe is ok without touching anything', async ({ request }) => {
  const res = await request.get('/api/health')
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})

test('the deep probe asks the database and answers with only the flag', async ({ request }) => {
  const res = await request.get('/api/health?deep=1')
  expect(res.status()).toBe(200)
  expect(await res.json()).toEqual({ ok: true })
})
