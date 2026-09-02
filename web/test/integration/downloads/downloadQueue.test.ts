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

  it('includes SEARCHING rows in the same bucket as DOWNLOADING/ENRICHING', async () => {
    const { fetchActiveQueueRows } = await import('../../../server/utils/downloadQueue')

    const searching = await makeDownloadedRelease(prisma, { status: 'SEARCHING' })

    const rows = await fetchActiveQueueRows()

    expect(rows.some(r => r.id === searching.id)).toBe(true)
  })
})

describe('downloadQueue.ts fetchHistoryQueueRows (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('does not include ABANDONED - it stays in the Failed/active bucket, never both (audit #75)', async () => {
    const { fetchActiveQueueRows, fetchHistoryQueueRows } = await import('../../../server/utils/downloadQueue')

    const abandoned = await makeDownloadedRelease(prisma, { status: 'ABANDONED' })
    const promoted = await makeDownloadedRelease(prisma, { status: 'PROMOTED' })
    const invalid = await makeDownloadedRelease(prisma, { status: 'INVALID' })

    const [active, history] = await Promise.all([fetchActiveQueueRows(), fetchHistoryQueueRows()])

    expect(active.map(r => r.id)).toContain(abandoned.id)
    expect(history.map(r => r.id)).not.toContain(abandoned.id)
    expect(history.map(r => r.id).sort()).toEqual([invalid.id, promoted.id].sort())

    const activeIds = new Set(active.map(r => r.id))
    expect(history.some(r => activeIds.has(r.id))).toBe(false)
  })
})

describe('downloadQueue.ts fetchRejectedQueueRows (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('returns only REJECTED rows, newest first', async () => {
    const { fetchRejectedQueueRows } = await import('../../../server/utils/downloadQueue')

    await makeDownloadedRelease(prisma, { status: 'FAILED' })
    await makeDownloadedRelease(prisma, { status: 'ABANDONED' })
    const older = await makeDownloadedRelease(prisma, { status: 'REJECTED', title: 'Older reject' })
    const newer = await makeDownloadedRelease(prisma, { status: 'REJECTED', title: 'Newer reject', updatedAt: new Date(Date.now() + 1000) })

    const rows = await fetchRejectedQueueRows()

    expect(rows.map(r => r.id)).toEqual([newer.id, older.id])
  })

  it('caps at ACTIVE_TAKE', async () => {
    const { fetchRejectedQueueRows, ACTIVE_TAKE } = await import('../../../server/utils/downloadQueue')

    await Promise.all(
      Array.from({ length: ACTIVE_TAKE + 20 }, () => makeDownloadedRelease(prisma, { status: 'REJECTED' })),
    )

    const rows = await fetchRejectedQueueRows()
    expect(rows).toHaveLength(ACTIVE_TAKE)
  })
})
