import { prisma } from '~/server/utils/prisma'

// PENDING issues across every issue table, for the sidebar badge. Seven tables, and the badge previously
// summed only five of them (duplicate-release and mismatched-release-id were missing), so it undercounted.
export const countPendingIssues = async (): Promise<number> => {
  const counts = await Promise.all([
    prisma.issueCorruptedTpe2.count({ where: { status: 'PENDING' } }),
    prisma.issueOrphanArtist.count({ where: { status: 'PENDING' } }),
    prisma.issueDuplicateArtist.count({ where: { status: 'PENDING' } }),
    prisma.issueMissingMetadata.count({ where: { status: 'PENDING' } }),
    prisma.issueEnrichmentGap.count({ where: { status: 'PENDING' } }),
    prisma.issueDuplicateRelease.count({ where: { status: 'PENDING' } }),
    prisma.issueMismatchedReleaseId.count({ where: { status: 'PENDING' } }),
  ])
  return counts.reduce((a, b) => a + b, 0)
}
