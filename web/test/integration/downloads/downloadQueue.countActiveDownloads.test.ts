import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeDownloadedRelease } from '../../../test/factories'
import { countActiveDownloads } from '../../../server/utils/downloadQueue'

const prisma = getTestPrisma()

// Backs the /downloads sidebar badge (GET /api/app-stats) - "active" here means in progress
// (Downloading/Enriching) or awaiting manual merge (Ready), never SEARCHING or a terminal status.
describe('countActiveDownloads (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('counts DOWNLOADING, ENRICHING and READY rows', async () => {
    await makeDownloadedRelease(prisma, { status: 'DOWNLOADING' })
    await makeDownloadedRelease(prisma, { status: 'ENRICHING' })
    await makeDownloadedRelease(prisma, { status: 'READY' })

    expect(await countActiveDownloads()).toBe(3)
  })

  it('excludes SEARCHING and every terminal status', async () => {
    await makeDownloadedRelease(prisma, { status: 'SEARCHING' })
    await makeDownloadedRelease(prisma, { status: 'PROMOTED' })
    await makeDownloadedRelease(prisma, { status: 'REJECTED' })
    await makeDownloadedRelease(prisma, { status: 'FAILED' })
    await makeDownloadedRelease(prisma, { status: 'ABANDONED' })
    await makeDownloadedRelease(prisma, { status: 'UNAVAILABLE' })
    await makeDownloadedRelease(prisma, { status: 'INVALID' })

    expect(await countActiveDownloads()).toBe(0)
  })

  it('returns 0 when there are no downloads at all', async () => {
    expect(await countActiveDownloads()).toBe(0)
  })
})
