import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeLocalRelease, makeMbRelease } from '../../../test/factories'
import { PREFERRED_LOCAL_COPY_ORDER } from '../../../server/utils/localCopy'

const prisma = getTestPrisma()

const pickCopy = async (mbId: string) => (await prisma.musicBrainzRelease.findUniqueOrThrow({
  where: { id: mbId },
  select: { localReleases: { select: { id: true }, orderBy: PREFERRED_LOCAL_COPY_ORDER, take: 1 } },
})).localReleases[0]?.id

describe('which duplicate local copy plays for an MB release (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('prefers the COMPLETE copy over an older incomplete one', async () => {
    const mb = await makeMbRelease(prisma)
    await makeLocalRelease(prisma, { releaseId: mb.id, matchStatus: 'INCOMPLETE', createdAt: new Date('2020-01-01') })
    const complete = await makeLocalRelease(prisma, { releaseId: mb.id, matchStatus: 'COMPLETE', createdAt: new Date('2024-01-01') })
    expect(await pickCopy(mb.id)).toBe(complete.id)
  })

  it('among equally complete copies takes the oldest, whatever the insert order', async () => {
    const mb = await makeMbRelease(prisma)
    await makeLocalRelease(prisma, { releaseId: mb.id, matchStatus: 'COMPLETE', createdAt: new Date('2024-01-01') })
    const oldest = await makeLocalRelease(prisma, { releaseId: mb.id, matchStatus: 'COMPLETE', createdAt: new Date('2019-01-01') })
    await makeLocalRelease(prisma, { releaseId: mb.id, matchStatus: 'COMPLETE', createdAt: new Date('2022-01-01') })
    expect(await pickCopy(mb.id)).toBe(oldest.id)
  })
})
