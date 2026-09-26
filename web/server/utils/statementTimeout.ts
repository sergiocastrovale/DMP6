import { AsyncLocalStorage } from 'node:async_hooks'
import type { Prisma } from '@prisma/client'
import { prisma } from '~/server/utils/prisma'

export type Db = Prisma.TransactionClient

// The client the current request's queries should use: the timeout-scoped transaction inside withStatementTimeout,
// the shared client everywhere else. Query modules call `db()` instead of importing the singleton, so a route can
// time-box them without threading a client through every function.
const scoped = new AsyncLocalStorage<Db>()
export const db = (): Db => scoped.getStore() ?? prisma

// Postgres reports a cancelled statement as SQLSTATE 57014, which Prisma surfaces either as a code or only in the message.
export const isStatementTimeout = (e: unknown): boolean => {
  const err = e as { code?: string, meta?: { code?: string }, message?: string } | null
  return err?.meta?.code === '57014' || err?.code === '57014' || /statement timeout/i.test(err?.message ?? '')
}

// Runs `fn` in a transaction whose statements Postgres cancels after `ms` (SET LOCAL semantics, so it never leaks
// into the pooled connection). The queries inside share one connection and therefore run one after another - use it
// for heavy reads that should be bounded, not to fan out.
export const withStatementTimeout = async <T>(ms: number, fn: (tx: Db) => Promise<T>): Promise<T> => {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(Math.trunc(ms))}, true)`
      return scoped.run(tx, () => fn(tx))
    }, { maxWait: 5_000, timeout: ms + 5_000 })
  }
  catch (e) {
    if (isStatementTimeout(e)) {
      throw createError({ statusCode: 503, statusMessage: 'The query took too long - try narrowing it' })
    }
    throw e
  }
}
