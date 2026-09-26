import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { getTestPrisma, resetDb } from '../../../test/setup/db'
import { makeUser, makeLocalTrack } from '../../../test/factories'
import { periodStart, recentPlayCounts } from '../../../server/utils/userPlays'

// The Statistics "Recent Plays" panel (helpers/constants.ts's playPeriods) - exercised against real
// Postgres because the period boundaries are DB-side date comparisons, not something a mocked-prisma
// unit test can prove (server/utils/userPlays.ts's periodStart itself is covered by a plain unit test).
const prisma = getTestPrisma()

const daysAgo = (n: number): Date => new Date(Date.now() - n * 86400000)

describe('recent play counts (real Postgres)', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('buckets counted plays into today/week/month/year by their startedAt', async () => {
    const alice = await makeUser(prisma)
    const track = await makeLocalTrack(prisma)

    await prisma.playEvent.createMany({
      data: [
        { userId: alice.id, trackId: track.id, source: 'QUEUE', counted: true, startedAt: daysAgo(0) }, // today, week, month, year
        { userId: alice.id, trackId: track.id, source: 'QUEUE', counted: true, startedAt: daysAgo(3) }, // week, month, year
        { userId: alice.id, trackId: track.id, source: 'QUEUE', counted: true, startedAt: daysAgo(40) }, // year only
        { userId: alice.id, trackId: track.id, source: 'QUEUE', counted: true, startedAt: daysAgo(400) }, // none
      ],
    })

    const counts = await recentPlayCounts(alice.id)
    expect(counts.today).toBe(1)
    expect(counts.week).toBe(2)
    // "month" is calendar-month-to-date, not a rolling 30 days - the 40-day-old row only counts if
    // today happens to be within 40 days of the 1st, so assert relative to the other buckets instead
    // of a hardcoded number.
    expect(counts.month).toBeGreaterThanOrEqual(counts.week)
    expect(counts.year).toBeGreaterThanOrEqual(counts.month)
    expect(counts.year).toBeLessThanOrEqual(3)
  })

  it('excludes uncounted (skipped-before-threshold) events', async () => {
    const alice = await makeUser(prisma)
    const track = await makeLocalTrack(prisma)
    await prisma.playEvent.create({
      data: { userId: alice.id, trackId: track.id, source: 'QUEUE', counted: false, startedAt: daysAgo(0) },
    })

    const counts = await recentPlayCounts(alice.id)
    expect(counts.today).toBe(0)
  })

  it('never counts another user\'s plays', async () => {
    const alice = await makeUser(prisma)
    const bob = await makeUser(prisma)
    const track = await makeLocalTrack(prisma)
    await prisma.playEvent.create({
      data: { userId: bob.id, trackId: track.id, source: 'QUEUE', counted: true, startedAt: daysAgo(0) },
    })

    const counts = await recentPlayCounts(alice.id)
    expect(counts.today).toBe(0)
  })

  it.each(['Pacific/Kiritimati', 'UTC', 'Pacific/Pago_Pago'])('"today" is the listener\'s calendar day in %s', async (tz) => {
    const alice = await makeUser(prisma)
    const track = await makeLocalTrack(prisma)
    const start = periodStart('today', new Date(), tz)
    await prisma.playEvent.createMany({
      data: [
        { userId: alice.id, trackId: track.id, source: 'QUEUE', counted: true, startedAt: new Date(start.getTime() + 1000) },
        { userId: alice.id, trackId: track.id, source: 'QUEUE', counted: true, startedAt: new Date(start.getTime() - 1000) },
      ],
    })

    expect((await recentPlayCounts(alice.id, tz)).today).toBe(1)
  })
})
