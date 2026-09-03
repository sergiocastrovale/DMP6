import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { VISUALIZER_HUD_IDLE_MS } from '~/helpers/constants'
import { createReadyGuard, onlyId } from './helpers/fixtures'

// The fullscreen visualizer, driven through the real app: the toggle in the player bar, the WebGL
// canvas the overlay mounts, the auto-hiding HUD, and Escape as the way out.
//
// Native fullscreen is stubbed rather than exercised. Headless Chromium's fullscreen transition is
// asynchronous and windowing-dependent, and it is not what these tests are about - what matters is
// that the overlay mounts, draws, and tears down. The CSS-only fallback path this stub produces is
// also the real path on iOS Safari, which refuses requestFullscreen on anything but a <video>.
const stubFullscreen = async (page: Page) => {
  await page.addInitScript(() => {
    Element.prototype.requestFullscreen = () => Promise.reject(new Error('stubbed in e2e'))
  })
}

const prisma = new PrismaClient()
const { markReady, isReady } = createReadyGuard()

let artistId: string
let artistSlug: string
let releaseId: string
let trackTitle: string
let artistName: string

// Start playback the way a user does: the fixture release's cover on the artist page carries a real
// PlayerPlayPauseButton, so this is a genuine user gesture - which is also what an AudioContext
// needs before it will leave its suspended state.
//
// playTrack() sets currentTrack and isVisible synchronously, before it awaits audio.play(), so the
// player bar and its visualizer toggle appear even though the fixture's file does not exist on disk
// and /api/audio 404s. The analyser then reads silence, which every preset handles and none of
// these assertions depend on.
const startPlayback = async (page: Page) => {
  await page.goto(`/artist/${artistSlug}`)
  await page.getByRole('button', { name: 'Play', exact: true }).first().click()
  await expect(page.getByTestId('visualizer-toggle')).toBeEnabled({ timeout: 15000 })
}

test.beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8)
  artistName = `E2E Visualizer Fixture ${suffix}`
  trackTitle = `E2E Visualizer Track ${suffix}`

  artistSlug = `e2e-visualizer-fixture-${suffix}`

  const artist = await prisma.artist.create({ data: { name: artistName, slug: artistSlug } })
  artistId = artist.id

  const release = await prisma.localRelease.create({
    data: {
      title: 'E2E Visualizer Fixture Album',
      year: 2020,
      groupKey: `folder:${artistName}/Album`,
      folderPath: `${artistName}/Album`,
      artists: { create: { artistId } },
      tracks: {
        create: {
          title: trackTitle,
          artist: artistName,
          albumArtist: artistName,
          album: 'E2E Visualizer Fixture Album',
          filePath: `${artistName}/Album/01.mp3`,
        },
      },
    },
  })
  releaseId = release.id

  markReady()
})

test.afterAll(async () => {
  if (isReady()) {
    await prisma.localRelease.deleteMany({ where: onlyId(releaseId) })
    await prisma.artist.deleteMany({ where: onlyId(artistId) })
  }
  await prisma.$disconnect()
})

test.describe('fullscreen visualizer', () => {
  test.beforeEach(async ({ page }) => {
    await stubFullscreen(page)
  })

  test('the toggle is unavailable until something is playing', async ({ page }) => {
    // The player bar itself only renders once the store has a track, so on a cold session the
    // toggle is not on the page at all. Explore's copy of it is, and must be disabled - there is
    // no audio element to tap before first playback, so opening would show a black screen.
    await page.goto('/')
    await expect(page.getByTestId('visualizer-toggle')).toHaveCount(0)

    await page.goto('/explore')
    await expect(page.getByTestId('visualizer-toggle')).toBeDisabled()
  })

  test('opens onto a WebGL canvas and closes on Escape', async ({ page }) => {
    await startPlayback(page)

    await page.getByTestId('visualizer-toggle').click()

    const overlay = page.getByTestId('visualizer-overlay')
    await expect(overlay).toBeVisible()
    await expect(overlay.locator('canvas')).toBeVisible()

    // A canvas with no drawing context would be an invisible failure - assert the overlay actually
    // acquired one rather than silently falling back to the unsupported message.
    await expect(overlay.getByText("This browser can't run the visualizer")).toHaveCount(0)

    await page.keyboard.press('Escape')
    await expect(overlay).toBeHidden()
  })

  test('the HUD names the track, fades when idle and comes back on movement', async ({ page }) => {
    await startPlayback(page)

    await page.getByTestId('visualizer-toggle').click()
    const hud = page.getByTestId('visualizer-hud')
    await expect(hud).toHaveClass(/opacity-100/)
    await expect(hud).toContainText(trackTitle)
    await expect(hud.getByRole('button', { name: 'Next track' })).toBeVisible()

    await expect(hud).toHaveClass(/opacity-0/, { timeout: VISUALIZER_HUD_IDLE_MS + 5000 })

    await page.mouse.move(400, 400)
    await expect(hud).toHaveClass(/opacity-100/)

    await page.keyboard.press('Escape')
  })

  test('switches preset from the HUD and remembers the choice', async ({ page }) => {
    await startPlayback(page)

    await page.getByTestId('visualizer-toggle').click()
    const hud = page.getByTestId('visualizer-hud')
    await hud.getByRole('button', { name: 'Fractal' }).click()
    await expect(hud.getByRole('button', { name: 'Fractal' })).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Escape')

    // A full reload, not just a reopen - the point is that the choice survives in localStorage
    // rather than only in the shared useState. Playback has to be restarted afterwards, since the
    // player store does not carry a queue across a reload.
    await startPlayback(page)
    await page.getByTestId('visualizer-toggle').click()

    await expect(hud.getByRole('button', { name: 'Fractal' })).toHaveAttribute('aria-pressed', 'true')
    await expect(hud.getByRole('button', { name: 'Chaos' })).toHaveAttribute('aria-pressed', 'false')

    await page.keyboard.press('Escape')
  })

  test('the "v" shortcut opens and closes it from anywhere', async ({ page }) => {
    await startPlayback(page)

    // A client-side nav, not page.goto: a full load would drop the queue and there would be no
    // track left for the shortcut to act on.
    await page.getByRole('link', { name: 'Browse' }).first().click()
    await expect(page).toHaveURL(/\/browse/)

    await page.keyboard.press('v')
    await expect(page.getByTestId('visualizer-overlay')).toBeVisible()

    await page.keyboard.press('v')
    await expect(page.getByTestId('visualizer-overlay')).toBeHidden()
  })

  test('Explore keeps its TV-mode button alongside the new one', async ({ page }) => {
    await page.goto('/explore')
    await expect(page.getByRole('button', { name: 'Enter fullscreen' })).toBeVisible()
    await expect(page.getByTestId('visualizer-toggle')).toBeVisible()
  })
})
