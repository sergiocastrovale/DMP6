import { prisma } from '~/server/utils/prisma'

export default defineEventHandler(async () => {
  const lastAudit = await prisma.auditRun.findFirst({
    orderBy: { startedAt: 'desc' },
  })

  const [corrupted, unsplit, orphans, duplicates, missing, enrichment] = await Promise.all([
    prisma.issueCorruptedTpe2.count({ where: { status: 'DETECTED' as const } }),
    prisma.issueUnsplitArtist.count({ where: { status: 'DETECTED' as const } }),
    prisma.issueOrphanArtist.count({ where: { status: 'DETECTED' as const } }),
    prisma.issueDuplicateArtist.count({ where: { status: 'DETECTED' as const } }),
    prisma.issueMissingMetadata.count({ where: { status: 'DETECTED' as const } }),
    prisma.issueEnrichmentGap.count({ where: { status: 'DETECTED' as const } }),
  ])

  return {
    lastAudit,
    counts: { corrupted, unsplit, orphans, duplicates, missing, enrichment },
  }
})
