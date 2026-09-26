import { PrismaClient } from '@prisma/client'
import { SLOW_QUERY_MS } from '~/helpers/constants'
import { createSlowQueryLogger } from '~/server/utils/slowQuery'

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient }

const createClient = (): PrismaClient => {
  const client = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] })
  // console, not monitorLog: monitorLog persists warnings as MonitorEvent rows and this module is what it imports.
  const report = createSlowQueryLogger(SLOW_QUERY_MS, line => console.warn(`[${new Date().toISOString()}][warn] ${line}`))
  client.$on('query', report)
  return client as unknown as PrismaClient
}

export const prisma = globalForPrisma.prisma || createClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
