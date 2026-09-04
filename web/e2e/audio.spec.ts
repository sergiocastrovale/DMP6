import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { expect, request, test } from '@playwright/test'
import { createReadyGuard, onlyId } from './helpers/fixtures'

// End-to-end coverage of the streaming contract that the unit tests (web/test/audioRange.test.ts)
// cover at the unit level - here exercised through the real Nitro handler + auth.
//
// This needs a track whose filePath resolves to a real file under MUSIC_DIR, or the handler 404s
// with no ETag before either assertion runs. Picking one via /api/tracks/random used to race every
// other spec's fixture creation (fullyParallel + a shared DB): those fixtures use fake filePaths
// for their own purposes and don't back a real file, so a run could hit one of those instead of an
// actual track and fail the ETag assertion non-deterministically. Owning a fixture that points at
// a real on-disk file removes the race entirely.

// Both tests share one fixture keyed on a real, fixed filePath (unique-constrained) - serial mode
// keeps beforeAll from running twice in two workers under fullyParallel, which double-inserted and
// violated that constraint.
test.describe.configure({ mode: 'serial' })

const prisma = new PrismaClient()
const { markReady, isReady } = createReadyGuard()

let artistId: string
let releaseId: string
let trackId: string

test.beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8)
  const artistName = `E2E Audio Fixture ${suffix}`

  const artist = await prisma.artist.create({ data: { name: artistName, slug: `e2e-audio-fixture-${suffix}` } })
  artistId = artist.id

  // A real file already on disk under MUSIC_DIR - fixed relative path, present in the library this
  // suite runs against.
  const realFilePath = `'68/EP/2020 - Love is Ain't Dead. (EP)/03 - Rock On.mp3`

  const release = await prisma.localRelease.create({
    data: {
      title: 'E2E Audio Fixture Album',
      year: 2020,
      groupKey: `folder:${artistName}/Album`,
      folderPath: `${artistName}/Album`,
      artists: { create: { artistId } },
      tracks: {
        create: {
          title: 'E2E Audio Fixture Track',
          artist: artistName,
          albumArtist: artistName,
          album: 'E2E Audio Fixture Album',
          filePath: realFilePath,
        },
      },
    },
    include: { tracks: true },
  })
  releaseId = release.id
  trackId = release.tracks[0]!.id

  markReady()
})

test.afterAll(async () => {
  if (isReady()) {
    await prisma.localRelease.deleteMany({ where: onlyId(releaseId) })
    await prisma.artist.deleteMany({ where: onlyId(artistId) })
  }
  await prisma.$disconnect()
})

test('Range request returns 206 with Content-Range', async ({ page }) => {
  await page.goto('/')

  const res = await page.request.get(`/api/audio/${trackId}`, { headers: { Range: 'bytes=0-99' } })
  expect(res.status()).toBe(206)
  const headers = res.headers()
  expect(headers['content-range']).toMatch(/^bytes 0-99\/\d+$/)
  expect(headers['accept-ranges']).toBe('bytes')
  expect(headers['content-length']).toBe('100')
})

test('matching If-None-Match returns 304', async ({ page }) => {
  await page.goto('/')

  const first = await page.request.get(`/api/audio/${trackId}`, { headers: { Range: 'bytes=0-0' } })
  const etag = first.headers().etag
  expect(etag).toBeTruthy()

  const cond = await page.request.get(`/api/audio/${trackId}`, { headers: { 'If-None-Match': etag ?? '' } })
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
