import { afterAll, describe, expect, it } from 'vitest'
import { getTestPrisma } from '../setup/db'

const prisma = getTestPrisma()

describe('LocalReleaseTrack autovacuum tuning', () => {
  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('vacuums at ~2% dead rows and analyzes at ~1% instead of the 20%/10% defaults', async () => {
    const rows = await prisma.$queryRaw<{ reloptions: string[] | null }[]>`
      SELECT reloptions FROM pg_class WHERE relname = 'LocalReleaseTrack' AND relkind = 'r'`
    expect(rows[0]?.reloptions).toEqual(expect.arrayContaining([
      'autovacuum_vacuum_scale_factor=0.02',
      'autovacuum_analyze_scale_factor=0.01',
    ]))
  })
})
