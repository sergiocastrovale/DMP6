import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeDownloadedRelease } from '../../../test/factories'

const prisma = getTestPrisma()

describe('downloadQueue.ts fetchActiveQueueRows (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('a large UNAVAILABLE backlog does not crowd DOWNLOADING/FAILED rows out of the response', async () => {
    const { fetchActiveQueueRows, ACTIVE_TAKE } = await import('../../../server/utils/downloadQueue')

    // Far more UNAVAILABLE rows than the per-bucket cap — the old single flat-LIMIT query (ordered
    // status asc, createdAt desc) could let a bucket this size push FAILED/DOWNLOADING off the page.
    await Promise.all(
      Array.from({ length: ACTIVE_TAKE + 50 }, () => makeDownloadedRelease(prisma, { status: 'UNAVAILABLE' })),
    )
    const downloading = await makeDownloadedRelease(prisma, { status: 'DOWNLOADING' })
    const failed = await makeDownloadedRelease(prisma, { status: 'FAILED' })

    const rows = await fetchActiveQueueRows()

    expect(rows.some(r => r.id === downloading.id)).toBe(true)
    expect(rows.some(r => r.id === failed.id)).toBe(true)
    expect(rows.filter(r => r.status === 'UNAVAILABLE').length).toBeLessThanOrEqual(ACTIVE_TAKE)
  })

  it('caps each bucket independently at ACTIVE_TAKE', async () => {
    const { fetchActiveQueueRows, ACTIVE_TAKE } = await import('../../../server/utils/downloadQueue')

    await Promise.all(
      Array.from({ length: ACTIVE_TAKE + 20 }, () => makeDownloadedRelease(prisma, { status: 'FAILED' })),
    )

    const rows = await fetchActiveQueueRows()
    expect(rows.filter(r => r.status === 'FAILED').length).toBe(ACTIVE_TAKE)
  })
})
