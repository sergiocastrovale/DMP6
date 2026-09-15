import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { invalidateSettingsCache } from '../../../server/utils/settingsCache'
import { fetchArtistFacts } from '../../../server/utils/genius'
import { factHash } from '../../../server/utils/geniusFacts'
import { ARTIST_FACTS_DB_THRESHOLD } from '../../../helpers/constants'

// Exercises fetchArtistFacts against real Postgres relations (Artist -> LocalReleaseArtist ->
// LocalRelease -> LocalReleaseTrack) with the Genius HTTP calls mocked, plus the
// threshold/dedupe query shapes GET /api/artists/[slug]/fact.get.ts relies on - same style as
// manuallyAddedArtists.test.ts (route logic reimplemented against the real schema rather than
// invoking the H3 handler directly).
const prisma = getTestPrisma()

const geniusSearchResponse = {
  meta: { status: 200 },
  response: {
    hits: [
      { type: 'song', result: { id: 78831, title: 'Paranoid Android', primary_artist: { id: 604, name: 'Radiohead' } } },
    ],
  },
}

const geniusSongResponse = {
  meta: { status: 200 },
  response: {
    id: 78831,
    url: 'https://genius.com/Radiohead-paranoid-android-lyrics',
    description: { plain: 'Paranoid Android was the first single from OK Computer and ran over six minutes long.' },
    album: { id: 17915, name: 'OK Computer' },
  },
}

const geniusAlbumResponse = {
  meta: { status: 200 },
  response: {
    url: 'https://genius.com/albums/Radiohead/Ok-computer',
    description_annotation: { annotations: [{ body: { plain: 'OK Computer was recorded partly at a Tudor mansion near Bath and became a landmark of the era.' } }] },
  },
}

const geniusArtistResponse = {
  meta: { status: 200 },
  response: {
    url: 'https://genius.com/artists/Radiohead',
    description: { plain: 'Radiohead formed in 1985 in Abingdon, England, originally under the name On A Friday.' },
  },
}

const stubGeniusFetch = () => {
  const fetchMock = vi.fn(async (url: string) => {
    const body = url.includes('/search')
      ? geniusSearchResponse
      : url.includes('/songs/')
        ? geniusSongResponse
        : url.includes('/albums/')
          ? geniusAlbumResponse
          : url.includes('/artists/')
            ? geniusArtistResponse
            : null
    return { ok: true, status: 200, json: async () => body } as Response
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const seedArtistWithOneTrack = async () => {
  const artist = await prisma.artist.create({ data: { name: 'Radiohead', slug: 'radiohead' } })
  const release = await prisma.localRelease.create({
    data: { title: 'OK Computer', groupKey: 'folder:/music/Radiohead/OK Computer' },
  })
  await prisma.localReleaseArtist.create({ data: { artistId: artist.id, localReleaseId: release.id } })
  const track = await prisma.localReleaseTrack.create({
    data: { title: 'Paranoid Android', filePath: '/music/Radiohead/OK Computer/02 Paranoid Android.flac', localReleaseId: release.id },
  })
  return { artist, release, track }
}

describe('artist "Did you know" facts (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
    await prisma.settings.upsert({
      where: { id: 'main' },
      create: { id: 'main', geniusAccessToken: 'test-token' },
      update: { geniusAccessToken: 'test-token' },
    })
    invalidateSettingsCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    invalidateSettingsCache()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('fetches a track fact and attaches the trackId', async () => {
    stubGeniusFetch()
    const { artist, track } = await seedArtistWithOneTrack()

    const result = await fetchArtistFacts(artist, 'track')

    expect(result?.trackId).toBe(track.id)
    expect(result?.releaseId).toBeUndefined()
    expect(result?.facts[0]).toContain('Paranoid Android was the first single')
  })

  it('fetches a release fact and attaches the releaseId', async () => {
    stubGeniusFetch()
    const { artist, release } = await seedArtistWithOneTrack()

    const result = await fetchArtistFacts(artist, 'release')

    expect(result?.releaseId).toBe(release.id)
    expect(result?.facts[0]).toContain('OK Computer was recorded')
  })

  it('fetches an artist fact with neither releaseId nor trackId', async () => {
    stubGeniusFetch()
    const { artist } = await seedArtistWithOneTrack()

    const result = await fetchArtistFacts(artist, 'artist')

    expect(result?.releaseId).toBeUndefined()
    expect(result?.trackId).toBeUndefined()
    expect(result?.facts[0]).toContain('Radiohead formed in 1985')
  })

  it('returns null when the artist has no local tracks to search from', async () => {
    stubGeniusFetch()
    const artist = await prisma.artist.create({ data: { name: 'No Files', slug: 'no-files' } })

    expect(await fetchArtistFacts(artist, 'artist')).toBeNull()
  })

  it('returns null when Genius is not configured', async () => {
    // GENIUS_ACCESS_TOKEN is set in the real .env this test process loads - stub it blank too so the
    // DB override being cleared is actually exercised, not masked by the env fallback.
    vi.stubEnv('GENIUS_ACCESS_TOKEN', '')
    await prisma.settings.update({ where: { id: 'main' }, data: { geniusAccessToken: null } })
    invalidateSettingsCache()
    const fetchMock = stubGeniusFetch()
    const { artist } = await seedArtistWithOneTrack()

    expect(await fetchArtistFacts(artist, 'artist')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('createMany with skipDuplicates never stores the same fact twice for an artist', async () => {
    const artist = await prisma.artist.create({ data: { name: 'Dup Band', slug: 'dup-band' } })
    const text = 'This exact fact text should only ever be stored once per artist.'
    const data = { artistId: artist.id, text, hash: factHash(text) }

    await prisma.artistFact.createMany({ data: [data], skipDuplicates: true })
    await prisma.artistFact.createMany({ data: [data], skipDuplicates: true })

    expect(await prisma.artistFact.count({ where: { artistId: artist.id } })).toBe(1)
  })

  it('DB-only threshold: an artist past ARTIST_FACTS_DB_THRESHOLD stored facts is flagged DB-only', async () => {
    const artist = await prisma.artist.create({ data: { name: 'Prolific Band', slug: 'prolific-band' } })
    await prisma.artistFact.createMany({
      data: Array.from({ length: ARTIST_FACTS_DB_THRESHOLD + 1 }, (_, i) => ({
        artistId: artist.id,
        text: `Fact number ${i} about this very prolific band.`,
        hash: factHash(`fact-${i}`),
      })),
    })

    const count = await prisma.artistFact.count({ where: { artistId: artist.id } })
    expect(count).toBeGreaterThan(ARTIST_FACTS_DB_THRESHOLD)
  })
})
