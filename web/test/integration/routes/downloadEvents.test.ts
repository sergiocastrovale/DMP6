import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { prisma } from '../../../server/utils/prisma'
import { downloadChanges } from '../../../server/utils/downloadEvents'
import { setMergeProgress, clearMergeProgress } from '../../../server/utils/mergeProgress'
import { DOWNLOAD_EVENTS_SETTLE_MS } from '../../../helpers/constants'

// The push is wired at the Prisma client: every write to a DownloadedRelease row, wherever in the app it is made, must
// announce itself. Real Postgres, because what is being checked is the SQL Prisma actually logs.
const admin = getTestPrisma()
const versions: number[] = []
let unsubscribe: () => void

const settled = () => new Promise(resolve => setTimeout(resolve, DOWNLOAD_EVENTS_SETTLE_MS + 150))

describe('download change events (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
    versions.length = 0
    unsubscribe = downloadChanges.subscribe(v => versions.push(v))
  })

  afterEach(() => {
    unsubscribe()
  })

  afterAll(async () => {
    await admin.$disconnect()
  })

  it('announces a create, an update and a delete of a download row', async () => {
    const row = await prisma.downloadedRelease.create({ data: { title: 'Push', year: 2020, status: 'FAILED' } })
    await settled()
    expect(versions).toHaveLength(1)

    await prisma.downloadedRelease.update({ where: { id: row.id }, data: { status: 'READY' } })
    await settled()
    expect(versions).toHaveLength(2)

    await prisma.downloadedRelease.updateMany({ where: { id: row.id }, data: { status: 'FAILED' } })
    await settled()
    expect(versions).toHaveLength(3)

    await prisma.downloadedRelease.deleteMany({ where: { id: row.id } })
    await settled()
    expect(versions).toHaveLength(4)
  })

  it('announces a write made inside a transaction once, after it committed', async () => {
    const row = await admin.downloadedRelease.create({ data: { title: 'Tx', year: 2020, status: 'READY' } })
    versions.length = 0

    let seenAtDelivery: string | undefined
    unsubscribe()
    unsubscribe = downloadChanges.subscribe(async () => {
      seenAtDelivery = (await admin.downloadedRelease.findUniqueOrThrow({ where: { id: row.id } })).status
      versions.push(1)
    })

    await prisma.$transaction(async (tx) => {
      await tx.downloadedRelease.update({ where: { id: row.id }, data: { status: 'PROMOTED' } })
      await tx.downloadedRelease.update({ where: { id: row.id }, data: { attempts: 5 } })
    })
    await settled()

    expect(versions).toHaveLength(1)
    expect(seenAtDelivery).toBe('PROMOTED')
  })

  it('does not announce reads or writes to other tables', async () => {
    await prisma.downloadedRelease.findMany()
    await prisma.artist.findMany()
    await prisma.rolePermission.count()
    await settled()
    expect(versions).toEqual([])
  })

  it('announces a merge batch changing, which lives in memory rather than in a row', async () => {
    setMergeProgress('a', { step: 'moving', title: 'A' })
    await settled()
    expect(versions).toHaveLength(1)

    clearMergeProgress('a')
    await settled()
    expect(versions).toHaveLength(2)
  })
})
