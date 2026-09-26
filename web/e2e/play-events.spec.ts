import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { expect, test } from '@playwright/test'
import { createReadyGuard, onlyId } from './helpers/fixtures'

// Every play - from the normal player and Explore alike, since both route through stores/player.ts's
// single playTrack() - opens a PlayEvent (composables/usePlayEventTracker.ts, POST /api/play-events)
// and closes it on track change/dismiss/end (PATCH .../[id]). playTrack() fires the open call before
// awaiting audio.play(), so the event is created even though this fixture's file doesn't actually
// decode - real audio playback/timing is covered by the unit-level tracker tests instead.
const prisma = new PrismaClient()
const { markReady, isReady } = createReadyGuard()

let artistId: string
let releaseId: string
let trackId: string
let trackTitle: string
let artistSlug: string

test.beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8)
  const artistName = `E2E Play Events Fixture ${suffix}`
  artistSlug = `e2e-play-events-fixture-${suffix}`
  trackTitle = `E2E Play Events Track ${suffix}`

  const artist = await prisma.artist.create({ data: { name: artistName, slug: artistSlug } })
  artistId = artist.id

  const release = await prisma.localRelease.create({
    data: {
      title: 'E2E Play Events Fixture Album',
      year: 2020,
      groupKey: `folder:${artistName}/Album`,
      folderPath: `${artistName}/Album`,
      artists: { create: { artistId } },
      tracks: {
        create: {
          title: trackTitle,
          artist: artistName,
          albumArtist: artistName,
          album: 'E2E Play Events Fixture Album',
          filePath: `${artistName}/Album/01.mp3`,
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

// The fixture track has no file on disk, and a file that will not load is (correctly) skipped by the player - so the
// audio request is answered with two seconds of silence.
const silentWav = (seconds = 2, rate = 8000) => {
  const data = Buffer.alloc(seconds * rate, 0x80)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate, 28)
  header.writeUInt16LE(1, 32)
  header.writeUInt16LE(8, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

test('playing a track opens a PlayEvent, and skipping to the next one closes it as skipped', async ({ page }) => {
  await page.route('**/api/audio/**', route => route.fulfill({ status: 200, contentType: 'audio/wav', body: silentWav() }))
  await page.goto(`/artist/${artistSlug}`)
  await page.getByRole('button', { name: 'Play', exact: true }).first().click()
  await expect(page.getByText(trackTitle).and(page.locator(':visible'))).toBeVisible()

  await expect.poll(() => prisma.playEvent.count({ where: { trackId } })).toBe(1)
  const opened = await prisma.playEvent.findFirstOrThrow({ where: { trackId } })
  expect(opened.source).toBe('QUEUE')
  expect(opened.counted).toBe(false)

  // A single-track queue wraps "next" back to the same track - still a real playTrack() call, which
  // finishes the still-open event before opening a fresh one (stores/player.ts).
  await page.getByRole('button', { name: 'Next track' }).click()

  await expect.poll(async () => {
    const closed = await prisma.playEvent.findUnique({ where: { id: opened.id } })
    return closed?.skipped ?? null
  }).toBe(true)
})
