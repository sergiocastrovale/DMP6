import { prisma } from '~/server/utils/prisma'
import { requirePermission } from '~/server/utils/permissions'

export default defineEventHandler(async (event) => {
  await requirePermission(event, 'issues.view')

  const lastAudit = await prisma.auditRun.findFirst({
    orderBy: { startedAt: 'desc' },
  })

  const [corrupted, orphans, duplicates, missing, enrichment, duplicateRelease, mismatchedReleaseId] = await Promise.all([
    prisma.issueCorruptedTpe2.count({ where: { status: 'DETECTED' as const } }),
    prisma.issueOrphanArtist.count({ where: { status: 'DETECTED' as const } }),
    prisma.issueDuplicateArtist.count({ where: { status: 'DETECTED' as const } }),
    prisma.issueMissingMetadata.count({ where: { status: 'DETECTED' as const } }),
    prisma.issueEnrichmentGap.count({ where: { status: 'DETECTED' as const } }),
    prisma.issueDuplicateRelease.count({ where: { status: 'DETECTED' as const } }),
    prisma.issueMismatchedReleaseId.count({ where: { status: 'DETECTED' as const } }),
  ])

  return {
    lastAudit,
    counts: {
      corrupted, orphans, duplicates, missing, enrichment,
      'duplicate-release': duplicateRelease,
      'mismatched-release-id': mismatchedReleaseId,
    },
  }
})
