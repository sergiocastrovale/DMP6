import { prisma } from '~/server/utils/prisma'

// One cover per MusicBrainz release: duplicate folders of the same release share its `releaseId`, and a release with no
// MusicBrainz match stands for itself. Oldest folder wins, so a re-scan does not reshuffle the mosaic.
export const fetchMosaicSources = () =>
  prisma.$queryRaw<{ image: string, year: number | null }[]>`
    SELECT DISTINCT ON (COALESCE("releaseId", id)) image, year
    FROM "LocalRelease"
    WHERE image IS NOT NULL
    ORDER BY COALESCE("releaseId", id), "createdAt" ASC
  `
