import { afterAll, describe, expect, it } from 'vitest'
import { getTestPrisma } from '../../../test/setup/db'
import { db, isStatementTimeout, withStatementTimeout } from '../../../server/utils/statementTimeout'
import { prisma } from '../../../server/utils/prisma'

const testPrisma = getTestPrisma()

describe('withStatementTimeout (real Postgres)', () => {
  afterAll(async () => {
    await testPrisma.$disconnect()
    await prisma.$disconnect()
  })

  it('cancels a statement that outlives the limit and answers 503', async () => {
    const started = Date.now()
    await expect(withStatementTimeout(200, () => db().$queryRaw`SELECT pg_sleep(5)`))
      .rejects.toMatchObject({ statusCode: 503 })
    expect(Date.now() - started).toBeLessThan(3_000)
  })

  it('lets a fast statement through and returns its value', async () => {
    expect(await withStatementTimeout(5_000, async () => (await db().$queryRaw<{ n: number }[]>`SELECT 7::int AS n`)[0]!.n)).toBe(7)
  })

  it('does not leak the timeout into the pooled connection afterwards', async () => {
    await withStatementTimeout(200, async () => db().$queryRaw`SELECT 1`)
    for (let i = 0; i < 5; i++) {
      const rows = await prisma.$queryRaw<{ setting: string }[]>`SELECT current_setting('statement_timeout') AS setting`
      expect(rows[0]!.setting).toBe('0')
    }
  })

  it('db() is the shared client outside a scope and the transaction inside it', async () => {
    expect(db()).toBe(prisma)
    await withStatementTimeout(1_000, async (tx) => {
      expect(db()).toBe(tx)
    })
    expect(db()).toBe(prisma)
  })

  it('does not swallow other errors', async () => {
    await expect(withStatementTimeout(1_000, () => db().$queryRaw`SELECT * FROM "NoSuchTable"`)).rejects.not.toMatchObject({ statusCode: 503 })
  })
})

describe('isStatementTimeout', () => {
  it('recognises the SQLSTATE and the message', () => {
    expect(isStatementTimeout({ meta: { code: '57014' } })).toBe(true)
    expect(isStatementTimeout({ message: 'canceling statement due to statement timeout' })).toBe(true)
    expect(isStatementTimeout(new Error('boom'))).toBe(false)
    expect(isStatementTimeout(null)).toBe(false)
  })
})
