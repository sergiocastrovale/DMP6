import type { Prisma } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'

export interface StoredFactRow {
  text: string
  sourceUrl: string | null
  release: { id: string, title: string } | null
  track: { id: string, title: string | null } | null
}

const randomFact = async (where: Prisma.ArtistFactWhereInput): Promise<StoredFactRow | null> => {
  const total = await prisma.artistFact.count({ where })
  if (!total) {return null}
  return prisma.artistFact.findFirst({
    where,
    skip: Math.floor(Math.random() * total),
    include: {
      release: { select: { id: true, title: true } },
      track: { select: { id: true, title: true } },
    },
  })
}

// Specificity cascade for "Did you know" (Explore's now-playing widget - see
// docs/feature_did_you_know.md): a stored fact about the exact playing track, else about its
// release, else a general one about the artist - never a fact about a *different* track/release of
// the same artist, which would misrepresent what's currently playing. Used both to serve an
// already-stored fact and, after a Genius fetch seeds new rows, to re-pick from whichever tier that
// fetch just populated.
export const pickStoredFact = async (params: {
  artistId: string
  trackId: string
  releaseId: string | null
}): Promise<StoredFactRow | null> =>
  await randomFact({ trackId: params.trackId })
  ?? (params.releaseId ? await randomFact({ releaseId: params.releaseId }) : null)
  ?? await randomFact({ artistId: params.artistId, trackId: null, releaseId: null })
