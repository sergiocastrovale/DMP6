import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { createReadyGuard, onlyId } from './helpers/fixtures'

// Favorites and MANUAL playlists are per-user and private (CLAUDE.md Data Model): two users acting
// on the same release/track never see or touch each other's rows, admin included. Two logins in one
// spec (rather than two browser contexts) since logging in just overwrites the session cookie.

const prisma = new PrismaClient()
const { markReady, isReady } = createReadyGuard()

let artistId: string
let releaseId: string
let bobUsername: string
const bobPassword = 'e2e-bob-pass'

test.use({ storageState: { cookies: [], origins: [] } })

const loginAs = async (page: Page, username: string, password: string) => {
  // /login redirects straight to / when a session cookie is already valid, so switching users
  // mid-spec needs a clean slate first. Clearing at the browser-context level - never by posting
  // /api/auth/logout through page.request - for two reasons: 'admin' is the one shared account
  // every other spec's default storageState session also authenticates as, and logout's
  // destroySession bumps that user's tokenVersion, which invalidates every session issued for them
  // - including every other spec's, running concurrently in the same CI worker (this is exactly
  // what broke all of visualizer.spec.ts in the same run: their shared admin session went stale
  // mid-test the moment this file logged it out). Even ignoring that, it also raced: the gap
  // between that request's Set-Cookie and the page's own cookie jar picking it up was wide enough
  // under CI load for the next goto('/login') to still see the old session and self-redirect to
  // '/', so the fill/submit below silently targeted a login form that was never there.
  await page.context().clearCookies()
  await page.goto('/login')
  const submit = page.getByRole('button', { name: 'Sign in' })
  await expect(async () => {
    await page.getByLabel('Username').fill(username)
    await page.getByLabel('Password', { exact: true }).fill(password)
    await expect(submit).toBeEnabled({ timeout: 1000 })
  }).toPass()
  const [response] = await Promise.all([
    page.waitForResponse(res => res.url().endsWith('/api/auth/login')),
    submit.click(),
  ])
  if (!response.ok()) {
    throw new Error(`login as ${username} failed: ${response.status()} ${await response.text()}`)
  }
  await page.waitForURL('/')
}

test.beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8)
  bobUsername = `e2e-bob-${suffix}`

  const artist = await prisma.artist.create({ data: { name: `E2E Library Fixture ${suffix}`, slug: `e2e-library-fixture-${suffix}` } })
  artistId = artist.id
  const release = await prisma.localRelease.create({
    data: { title: `E2E Fixture Release ${suffix}`, groupKey: `meta:e2e-library-${suffix}`, year: 2020, matchStatus: 'UNMATCHED' },
  })
  releaseId = release.id

  await prisma.user.create({
    data: {
      username: bobUsername,
      email: `${bobUsername}@local`,
      passwordHash: await bcrypt.hash(bobPassword, 12),
      role: 'VIEWER',
      mustChangePassword: false,
    },
  })

  markReady()
})

test.afterAll(async () => {
  if (!isReady()) {
    await prisma.$disconnect()
    return
  }
  await prisma.localRelease.deleteMany({ where: onlyId(releaseId) })
  await prisma.artist.deleteMany({ where: onlyId(artistId) })
  await prisma.user.deleteMany({ where: { username: bobUsername || '__never_matches__' } })
  await prisma.$disconnect()
})

test('favoriting a release and creating a playlist is private to the acting user', async ({ page }) => {
  await loginAs(page, 'admin', 'admin')

  expect((await page.request.post(`/api/favorites/releases/${releaseId}`)).status()).toBe(200)
  const createAdminPlaylist = await page.request.post('/api/playlists', { data: { name: `Admin Mix ${randomUUID().slice(0, 6)}` } })
  expect(createAdminPlaylist.status()).toBe(200)
  const { playlist: adminPlaylist } = await createAdminPlaylist.json()

  const adminFavorites = await (await page.request.get('/api/favorites')).json()
  expect(adminFavorites.releases.some((f: any) => f.release.id === releaseId)).toBe(true)

  // Switch to bob: neither the release favorite nor the playlist admin just created are visible.
  await loginAs(page, bobUsername, bobPassword)

  const bobFavoritesBefore = await (await page.request.get('/api/favorites')).json()
  expect(bobFavoritesBefore.releases).toHaveLength(0)

  const bobPlaylistsBefore = await (await page.request.get('/api/playlists?type=manual')).json()
  expect(bobPlaylistsBefore.some((p: any) => p.slug === adminPlaylist.slug)).toBe(false)

  expect((await page.request.get(`/api/playlists/${adminPlaylist.slug}`)).status()).toBe(404)
  expect((await page.request.delete(`/api/playlists/${adminPlaylist.slug}`)).status()).toBe(404)

  // Bob favorites the same release and makes his own playlist of the same name.
  expect((await page.request.post(`/api/favorites/releases/${releaseId}`)).status()).toBe(200)
  const createBobPlaylist = await page.request.post('/api/playlists', { data: { name: adminPlaylist.name } })
  expect(createBobPlaylist.status()).toBe(200)
  const { playlist: bobPlaylist } = await createBobPlaylist.json()
  expect(bobPlaylist.slug).toBe(adminPlaylist.slug) // same slug allowed - different owners

  const bobFavoritesAfter = await (await page.request.get('/api/favorites')).json()
  expect(bobFavoritesAfter.releases.map((f: any) => f.release.id)).toEqual([releaseId])

  // Back to admin: still sees only their own favorite/playlist, unaffected by bob's.
  await loginAs(page, 'admin', 'admin')

  const adminFavoritesAfter = await (await page.request.get('/api/favorites')).json()
  expect(adminFavoritesAfter.releases.map((f: any) => f.release.id)).toEqual([releaseId])

  const adminPlaylistsAfter = await (await page.request.get('/api/playlists?type=manual')).json()
  const adminOwnedRow = adminPlaylistsAfter.find((p: any) => p.id === adminPlaylist.id)
  expect(adminOwnedRow).toBeTruthy()

  // Cleanup both playlists via their owners' own sessions.
  expect((await page.request.delete(`/api/playlists/${adminPlaylist.slug}`)).status()).toBe(200)
  await loginAs(page, bobUsername, bobPassword)
  expect((await page.request.delete(`/api/playlists/${bobPlaylist.slug}`)).status()).toBe(200)
})
