import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../setup/db'
import {
  makeAuditRun, makeIssueCorrupted, makeIssueDuplicateRelease, makeIssueMismatchedReleaseId,
  makeLocalRelease, makeLocalTrack, makeArtist,
} from '../../factories'
import { countPendingIssues } from '../../../server/utils/issueCounts'

const prisma = getTestPrisma()

describe('countPendingIssues (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('is zero with no issues', async () => {
    expect(await countPendingIssues()).toBe(0)
  })

  it('counts PENDING issues from all seven tables and ignores other statuses', async () => {
    const track = await makeLocalTrack(prisma)
    const a = await makeLocalRelease(prisma)
    const b = await makeLocalRelease(prisma)
    const artist = await makeArtist(prisma)
    const artistB = await makeArtist(prisma)
    const run = await makeAuditRun(prisma)

    await makeIssueCorrupted(prisma, track.id, { status: 'PENDING', currentValue: 'Bad Value' })
    await makeIssueDuplicateRelease(prisma, a.id, b.id, { status: 'PENDING' })
    await makeIssueMismatchedReleaseId(prisma, a.id, b.id, { status: 'PENDING' })
    await prisma.issueOrphanArtist.create({ data: { auditRunId: run.id, artistId: artist.id, reason: 'x', status: 'PENDING' } })
    await prisma.issueDuplicateArtist.create({ data: { auditRunId: run.id, artistAId: artist.id, artistBId: artistB.id, status: 'PENDING' } })
    await prisma.issueMissingMetadata.create({ data: { auditRunId: run.id, trackId: track.id, missingFields: ['year'], status: 'PENDING' } })
    await prisma.issueEnrichmentGap.create({ data: { auditRunId: run.id, localReleaseId: a.id, missingFields: ['bpm'], status: 'PENDING' } })

    // Not PENDING - must not count.
    await makeIssueCorrupted(prisma, track.id, { status: 'DETECTED', currentValue: 'Bad Value' })
    await makeIssueDuplicateRelease(prisma, a.id, b.id, { status: 'RESOLVED' })

    expect(await countPendingIssues()).toBe(7)
  })
})
