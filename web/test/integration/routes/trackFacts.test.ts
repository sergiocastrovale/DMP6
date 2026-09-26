import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { invalidateSettingsCache, refreshSettingsCache } from '../../../server/utils/settingsCache'
import { resetMemoryCacheForTests } from '../../../server/utils/cache'
import { fetchFactsForTrack } from '../../../server/utils/genius'
import { pickStoredFact } from '../../../server/utils/artistFacts'
import { factHash } from '../../../server/utils/geniusFacts'

// Exercises GET /api/tracks/[id]/fact.get.ts's two building blocks against real Postgres relations
// (Artist -> LocalReleaseArtist -> LocalRelease -> LocalReleaseTrack): pickStoredFact()'s DB
// specificity cascade, and fetchFactsForTrack()'s deterministic Genius cascade (HTTP mocked) - same
// style as manuallyAddedArtists.test.ts (route logic reimplemented against the real schema rather
// than invoking the H3 handler directly).
const prisma = getTestPrisma()

const geniusSearchResponse = {
  meta: { status: 200 },
  response: {
    hits: [
      { type: 'song', result: { id: 78831, title: 'Paranoid Android', primary_artist: { id: 604, name: 'Radiohead' } } },
    ],
  },
}

// Genius nests each entity one level deeper than the bare `response` envelope
// (response.song / response.album / response.artist) - geniusGet() only unwraps `response`, so
// fixtures here must mirror the real API shape.
const geniusSongResponse = (description: string | null) => ({
  meta: { status: 200 },
  response: {
    song: {
      id: 78831,
      url: 'https://genius.com/Radiohead-paranoid-android-lyrics',
      description: { plain: description },
      album: { id: 17915, name: 'OK Computer' },
    },
  },
})

const geniusAlbumResponse = (description: string | null) => ({
  meta: { status: 200 },
  response: {
    album: {
      url: 'https://genius.com/albums/Radiohead/Ok-computer',
      description_annotation: { annotations: [{ body: { plain: description } }] },
    },
  },
})

const geniusArtistResponse = {
  meta: { status: 200 },
  response: {
    artist: {
      url: 'https://genius.com/artists/Radiohead',
      description: { plain: 'Radiohead formed in 1985 in Abingdon, England, originally under the name On A Friday.' },
    },
  },
}

const stubGeniusFetch = (songDescription: string | null, albumDescription: string | null) => {
  const fetchMock = vi.fn(async (url: string) => {
    const body = url.includes('/search')
      ? geniusSearchResponse
      : url.includes('/songs/')
        ? geniusSongResponse(songDescription)
        : url.includes('/albums/')
          ? geniusAlbumResponse(albumDescription)
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

describe('"Did you know" for a playing track (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
    // Genius responses are cached (in-process when there is no Redis); each test stubs its own HTTP.
    resetMemoryCacheForTests()
    await prisma.settings.upsert({
      where: { id: 'main' },
      create: { id: 'main', geniusAccessToken: 'test-token' },
      update: { geniusAccessToken: 'test-token' },
    })
    invalidateSettingsCache()
    // getCachedSettings() returns process.env defaults synchronously right after invalidation and
    // refreshes from the DB in the background - without this await, isGeniusConfigured() races that
    // refresh and can read a stale/empty token whenever GENIUS_ACCESS_TOKEN isn't already set in the
    // environment (masked locally by web/.env, but not in CI - see settingsCache.ts).
    await refreshSettingsCache()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    invalidateSettingsCache()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  describe('fetchFactsForTrack (deterministic, pinned to the known track)', () => {
    it('returns a track-tier fact when the song has its own description', async () => {
      stubGeniusFetch('Paranoid Android was the first single from OK Computer and ran over six minutes long.', null)
      const { artist, track } = await seedArtistWithOneTrack()

      const result = await fetchFactsForTrack(track, artist)

      expect(result?.trackId).toBe(track.id)
      expect(result?.releaseId).toBeUndefined()
      expect(result?.facts[0]).toContain('Paranoid Android was the first single')
    })

    it('falls through to a release-tier fact when the song itself has no description', async () => {
      stubGeniusFetch(null, 'OK Computer was recorded partly at a Tudor mansion near Bath and became a landmark of the era.')
      const { artist, release, track } = await seedArtistWithOneTrack()

      const result = await fetchFactsForTrack(track, artist)

      expect(result?.releaseId).toBe(release.id)
      expect(result?.trackId).toBeUndefined()
      expect(result?.facts[0]).toContain('OK Computer was recorded')
    })

    it('falls all the way through to an artist-tier fact when neither song nor album has text', async () => {
      stubGeniusFetch(null, null)
      const { artist, track } = await seedArtistWithOneTrack()

      const result = await fetchFactsForTrack(track, artist)

      expect(result?.releaseId).toBeUndefined()
      expect(result?.trackId).toBeUndefined()
      expect(result?.facts[0]).toContain('Radiohead formed in 1985')
    })

    it('returns null when Genius has no matching song at all', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ response: { hits: [] } }) } as Response)))
      const { artist, track } = await seedArtistWithOneTrack()

      expect(await fetchFactsForTrack(track, artist)).toBeNull()
    })

    it('returns null when Genius is not configured', async () => {
      vi.stubEnv('GENIUS_ACCESS_TOKEN', '')
      await prisma.settings.update({ where: { id: 'main' }, data: { geniusAccessToken: null } })
      invalidateSettingsCache()
      await refreshSettingsCache()
      const fetchMock = stubGeniusFetch('some text', null)
      const { artist, track } = await seedArtistWithOneTrack()

      expect(await fetchFactsForTrack(track, artist)).toBeNull()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('pickStoredFact (DB specificity cascade)', () => {
    it('prefers a fact about the exact playing track over one about its release or artist', async () => {
      const { artist, release, track } = await seedArtistWithOneTrack()
      await prisma.artistFact.createMany({
        data: [
          { artistId: artist.id, text: 'General artist fact.', hash: factHash('artist') },
          { artistId: artist.id, releaseId: release.id, text: 'Release fact.', hash: factHash('release') },
          { artistId: artist.id, trackId: track.id, text: 'Track fact.', hash: factHash('track') },
        ],
      })

      const row = await pickStoredFact({ artistId: artist.id, trackId: track.id, releaseId: release.id })

      expect(row?.text).toBe('Track fact.')
    })

    it('falls back to a release fact when there is none for the exact track', async () => {
      const { artist, release, track } = await seedArtistWithOneTrack()
      await prisma.artistFact.createMany({
        data: [
          { artistId: artist.id, text: 'General artist fact.', hash: factHash('artist') },
          { artistId: artist.id, releaseId: release.id, text: 'Release fact.', hash: factHash('release') },
        ],
      })

      const row = await pickStoredFact({ artistId: artist.id, trackId: track.id, releaseId: release.id })

      expect(row?.text).toBe('Release fact.')
    })

    it('falls back to a general artist fact when there is none for the track or release', async () => {
      const { artist, release, track } = await seedArtistWithOneTrack()
      await prisma.artistFact.create({
        data: { artistId: artist.id, text: 'General artist fact.', hash: factHash('artist') },
      })

      const row = await pickStoredFact({ artistId: artist.id, trackId: track.id, releaseId: release.id })

      expect(row?.text).toBe('General artist fact.')
    })

    it('never surfaces a fact tied to a different track or release of the same artist', async () => {
      const { artist, track } = await seedArtistWithOneTrack()
      const otherRelease = await prisma.localRelease.create({ data: { title: 'A Moon Shaped Pool', groupKey: 'folder:/music/Radiohead/A Moon Shaped Pool' } })
      const otherTrack = await prisma.localReleaseTrack.create({
        data: { title: 'Burn the Witch', filePath: '/music/Radiohead/A Moon Shaped Pool/01 Burn the Witch.flac', localReleaseId: otherRelease.id },
      })
      await prisma.artistFact.createMany({
        data: [
          { artistId: artist.id, trackId: otherTrack.id, text: 'Fact about a different track.', hash: factHash('other-track') },
          { artistId: artist.id, releaseId: otherRelease.id, text: 'Fact about a different release.', hash: factHash('other-release') },
        ],
      })

      expect(await pickStoredFact({ artistId: artist.id, trackId: track.id, releaseId: track.localReleaseId })).toBeNull()
    })

    it('returns null when nothing is stored for the track, its release, or the artist', async () => {
      const { artist, release, track } = await seedArtistWithOneTrack()

      expect(await pickStoredFact({ artistId: artist.id, trackId: track.id, releaseId: release.id })).toBeNull()
    })
  })
})
