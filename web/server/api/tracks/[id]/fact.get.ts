import { prisma } from '~/server/utils/prisma'
import { fetchFactsForTrack, isGeniusConfigured } from '~/server/utils/genius'
import { factHash } from '~/server/utils/geniusFacts'
import { pickStoredFact } from '~/server/utils/artistFacts'
import { ARTIST_FACTS_DB_THRESHOLD } from '~/helpers/constants'
import type { ArtistFactResponse } from '~/types/artist'

// "Did you know" for Explore's now-playing widget (components/explore/DidYouKnow.vue) - unlike the
// old artist-page endpoint (any random subject for that artist), this is scoped to what's actually
// playing via pickStoredFact()'s specificity cascade (track -> release -> artist), else nothing.
export default defineEventHandler(async (event): Promise<ArtistFactResponse | null> => {
  const id = getRouterParam(event, 'id')
  if (!id) {throw createError({ statusCode: 400, statusMessage: 'Missing id' })}

  const track = await prisma.localReleaseTrack.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      localReleaseId: true,
      localRelease: { select: { artists: { select: { artistId: true }, take: 1 } } },
    },
  })
  if (!track) {throw createError({ statusCode: 404, statusMessage: 'Track not found' })}

  const artistId = track.localRelease?.artists[0]?.artistId
  if (!artistId) {return null}

  let row = await pickStoredFact({ artistId, trackId: track.id, releaseId: track.localReleaseId })

  if (!row) {
    const storedCount = await prisma.artistFact.count({ where: { artistId } })
    const useDbOnly = storedCount > ARTIST_FACTS_DB_THRESHOLD || !isGeniusConfigured()

    if (!useDbOnly) {
      const artist = await prisma.artist.findUnique({ where: { id: artistId } })
      const fetched = artist ? await fetchFactsForTrack(track, artist) : null

      if (fetched?.facts.length) {
        await prisma.artistFact.createMany({
          data: fetched.facts.map(text => ({
            artistId,
            releaseId: fetched.releaseId ?? null,
            trackId: fetched.trackId ?? null,
            text,
            hash: factHash(text),
            sourceUrl: fetched.sourceUrl,
          })),
          skipDuplicates: true,
        })

        row = await pickStoredFact({ artistId, trackId: track.id, releaseId: track.localReleaseId })
      }
    }
  }

  if (!row) {return null}

  return {
    text: row.text,
    sourceUrl: row.sourceUrl,
    release: row.release,
    track: row.track,
  }
})
