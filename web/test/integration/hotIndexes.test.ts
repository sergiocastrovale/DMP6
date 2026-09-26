import { afterAll, describe, expect, it } from 'vitest'
import { getTestPrisma } from '../setup/db'

// Guards the hot-path indexes added for the 2M-track library: each query below is one the app runs per request
// (stats counts, /issues lists, /releases/updated) and each was a sequential scan before its index existed.
// A small fixture makes seq scan the cheaper plan, so `enable_seqscan = off` proves the index exists and matches
// the query rather than that the planner prefers it.
const prisma = getTestPrisma()

const planOf = (sql: string) => prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off')
  const rows = await tx.$queryRawUnsafe<Record<string, string>[]>(`EXPLAIN ${sql}`)
  return rows.map(r => r['QUERY PLAN']).join('\n')
})

describe('hot-path indexes (real Postgres, migrated schema)', () => {
  afterAll(async () => {
    await prisma.$disconnect()
  })

  const cases: [string, string, string][] = [
    ['LocalRelease_matchStatus_idx', 'stats unmatched count', `SELECT count(*) FROM "LocalRelease" WHERE "matchStatus" = 'UNMATCHED'`],
    ['LocalRelease_updatedAt_idx', 'recently updated releases', `SELECT id FROM "LocalRelease" WHERE "updatedAt" > "createdAt" ORDER BY "updatedAt" DESC LIMIT 50`],
    ['LocalReleaseTrack_title_id_idx', 'track stats list by title', `SELECT id, title, artist FROM "LocalReleaseTrack" ORDER BY title ASC, id ASC OFFSET 0 LIMIT 200`],
    ['LocalReleaseTrack_lowBitrate_idx', 'low-bitrate stats count', `SELECT count(*) FROM "LocalReleaseTrack" WHERE bitrate < 256 AND bitrate > 0`],
    ['IssueCorruptedTpe2_status_createdAt_idx', 'corrupted issue list', `SELECT id FROM "IssueCorruptedTpe2" WHERE status = 'DETECTED' ORDER BY "createdAt" DESC LIMIT 50`],
    ['IssueOrphanArtist_status_createdAt_idx', 'orphan issue list', `SELECT id FROM "IssueOrphanArtist" WHERE status = 'DETECTED' ORDER BY "createdAt" DESC LIMIT 50`],
    ['IssueDuplicateArtist_status_createdAt_idx', 'duplicate artist issue list', `SELECT id FROM "IssueDuplicateArtist" WHERE status = 'DETECTED' ORDER BY "createdAt" DESC LIMIT 50`],
    ['IssueDuplicateRelease_status_createdAt_idx', 'duplicate release issue list', `SELECT id FROM "IssueDuplicateRelease" WHERE status = 'DETECTED' ORDER BY "createdAt" DESC LIMIT 50`],
    ['IssueMismatchedReleaseId_status_createdAt_idx', 'mismatched release issue list', `SELECT id FROM "IssueMismatchedReleaseId" WHERE status = 'DETECTED' ORDER BY "createdAt" DESC LIMIT 50`],
    ['IssueMissingMetadata_status_createdAt_idx', 'missing metadata issue list', `SELECT id FROM "IssueMissingMetadata" WHERE status = 'DETECTED' ORDER BY "createdAt" DESC LIMIT 50`],
    ['IssueEnrichmentGap_status_createdAt_idx', 'enrichment issue list', `SELECT id FROM "IssueEnrichmentGap" WHERE status = 'DETECTED' ORDER BY "createdAt" DESC LIMIT 50`],
  ]

  for (const [index, what, sql] of cases) {
    it(`${what} can use ${index}`, async () => {
      expect(await planOf(sql)).toContain(index)
    })
  }
})
