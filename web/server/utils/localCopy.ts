import type { Prisma } from '@prisma/client'

// Several LocalReleases (duplicate folders) can bind to one MusicBrainzRelease. Which one plays must not depend
// on heap order: prefer the most complete copy - ReleaseStatus is declared COMPLETE first, so ascending puts it
// ahead of INCOMPLETE/EXTRA_TRACKS/... - then the oldest, then the id as the final tiebreak.
export const PREFERRED_LOCAL_COPY_ORDER: Prisma.LocalReleaseOrderByWithRelationInput[] = [
  { matchStatus: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
]
