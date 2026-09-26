import { Prisma, type PrismaClient } from '@prisma/client'
import { sampleIds } from '~/server/utils/randomSample'

export const ARCHIVE_AGE_YEARS = 2

// Where-clause for "archived" releases, for THIS user: nothing they played in the last two years, and either they
// have played it at some point (so its last play is over two years old) or they never have and it was added over
// two years ago. Evaluated by Postgres per candidate row - the previous version fetched every release the user
// had ever played, then passed those ids back as `id NOT IN (...)`, which grows with listening history and hits
// Postgres' 32,767 bind-parameter ceiling for a heavy listener.
export const archivedWhere = (userId: number, cutoff: Date): Prisma.Sql => Prisma.sql`
  NOT EXISTS (
    SELECT 1 FROM "LocalReleaseTrackPlay" p JOIN "LocalReleaseTrack" t ON t.id = p."trackId"
    WHERE t."localReleaseId" = "LocalRelease".id AND p."userId" = ${userId} AND p."lastPlayedAt" >= ${cutoff}
  )
  AND (
    "LocalRelease"."createdAt" < ${cutoff}
    OR EXISTS (
      SELECT 1 FROM "LocalReleaseTrackPlay" p JOIN "LocalReleaseTrack" t ON t.id = p."trackId"
      WHERE t."localReleaseId" = "LocalRelease".id AND p."userId" = ${userId}
    )
  )`

export const archiveCutoff = (now: Date = new Date()): Date => {
  const cutoff = new Date(now)
  cutoff.setFullYear(cutoff.getFullYear() - ARCHIVE_AGE_YEARS)
  return cutoff
}

// A random selection of up to `n` archived release ids (random by sampling, not "the newest 50 then shuffled").
export const randomArchivedReleaseIds = (prisma: PrismaClient, userId: number, n: number, now: Date = new Date()): Promise<string[]> =>
  sampleIds(prisma, 'LocalRelease', n, archivedWhere(userId, archiveCutoff(now)))
