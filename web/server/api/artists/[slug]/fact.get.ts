import { prisma } from '~/server/utils/prisma'
import { fetchArtistFacts, isGeniusConfigured } from '~/server/utils/genius'
import { factHash, pickSubject } from '~/server/utils/geniusFacts'
import { ARTIST_FACTS_DB_THRESHOLD } from '~/helpers/constants'

// Random "Did you know..." trivia fact for an artist. Once ArtistFacts has more than
// ARTIST_FACTS_DB_THRESHOLD rows for this artist, Genius is never called again - see CLAUDE.md Data
// Model. Deliberately uncached (random) unlike the other /artists/[slug]/* routes.
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')
  if (!slug) {throw createError({ statusCode: 400, statusMessage: 'Missing slug' })}

  const artist = await prisma.artist.findUnique({ where: { slug } })
  if (!artist) {throw createError({ statusCode: 404, statusMessage: 'Artist not found' })}

  const storedCount = await prisma.artistFact.count({ where: { artistId: artist.id } })
  const useDbOnly = storedCount > ARTIST_FACTS_DB_THRESHOLD || !isGeniusConfigured()

  if (!useDbOnly) {
    const fetched = await fetchArtistFacts(artist, pickSubject())
    if (fetched?.facts.length) {
      await prisma.artistFact.createMany({
        data: fetched.facts.map(text => ({
          artistId: artist.id,
          releaseId: fetched.releaseId ?? null,
          trackId: fetched.trackId ?? null,
          text,
          hash: factHash(text),
          sourceUrl: fetched.sourceUrl,
        })),
        skipDuplicates: true,
      })
    }
  }

  const total = await prisma.artistFact.count({ where: { artistId: artist.id } })
  if (!total) {return null}

  const row = await prisma.artistFact.findFirst({
    where: { artistId: artist.id },
    skip: Math.floor(Math.random() * total),
    include: {
      release: { select: { id: true, title: true } },
      track: { select: { id: true, title: true } },
    },
  })
  if (!row) {return null}

  return {
    text: row.text,
    sourceUrl: row.sourceUrl,
    release: row.release,
    track: row.track,
  }
})
