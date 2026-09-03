import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@prisma/client'
import { expect, test } from '@playwright/test'
import { createReadyGuard, onlyId } from './helpers/fixtures'

// stores/player.ts persists the queue/currentTrack to localStorage and restores it on the next
// load. That restore has to run in onMounted, not inline in the store's setup() body: Nuxt's Pinia
// SSR hydration patches every ref on a store back to the server-rendered value immediately after
// setup() returns (the player store always renders empty server-side, since the restore is
// `import.meta.client`-gated), which silently clobbered an inline restore back to null/[] before
// any component had even mounted - a real reload only "restored" the bar for a flash before wiping
// it, and the debounced save watcher then persisted that wiped state right back to localStorage,
// corrupting the next restore too. A component-tree unit test can't see this: it's specifically the
// SSR round-trip a full browser reload does that reproduces it.

const prisma = new PrismaClient()
const { markReady, isReady } = createReadyGuard()

let artistId: string
let artistSlug: string
let releaseId: string
let trackTitle: string
let artistName: string

test.beforeAll(async () => {
  const suffix = randomUUID().slice(0, 8)
  artistName = `E2E Player Persistence Fixture ${suffix}`
  artistSlug = `e2e-player-persistence-fixture-${suffix}`
  trackTitle = `E2E Player Persistence Track ${suffix}`

  const artist = await prisma.artist.create({ data: { name: artistName, slug: artistSlug } })
  artistId = artist.id

  const release = await prisma.localRelease.create({
    data: {
      title: 'E2E Player Persistence Fixture Album',
      year: 2020,
      groupKey: `folder:${artistName}/Album`,
      folderPath: `${artistName}/Album`,
      artists: { create: { artistId } },
      tracks: {
        create: {
          title: trackTitle,
          artist: artistName,
          albumArtist: artistName,
          album: 'E2E Player Persistence Fixture Album',
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

test('the player bar survives a full reload, not just a client-side navigation', async ({ page }) => {
  await page.goto(`/artist/${artistSlug}`)
  await page.getByRole('button', { name: 'Play', exact: true }).first().click()
  await expect(page.getByText(trackTitle)).toBeVisible()

  // stores/player.ts debounces the save to localStorage by 500ms (see the comment on saveState) -
  // reloading before that fires would discard a queue that was never written yet, which is a gap
  // in the test, not the bug under test. Waiting for the write to land is the real signal.
  await page.waitForFunction(() => {
    const saved = localStorage.getItem('dmp-player')
    return saved ? JSON.parse(saved).trackId != null : false
  }, { timeout: 5000 })

  // A real reload - this is what round-trips through the server and back, which is the only way
  // to reproduce the SSR-hydration clobber described above. Playwright's reload does a genuine
  // navigation, unlike a Vue Router push.
  await page.reload()

  await expect(page.getByText(trackTitle)).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: 'Dismiss player' })).toBeVisible()

  // The regression left the persisted state nulled out too, so a second reload would already come
  // up empty even if the first happened to look fine - assert what's now on disk, not just the DOM.
  const persisted = await page.evaluate(() => localStorage.getItem('dmp-player'))
  expect(JSON.parse(persisted!).trackId).not.toBeNull()
})
