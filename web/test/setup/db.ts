import { execFileSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'
// Extensioned: e2e/with-test-db.ts loads this under Node's own ESM resolver (type-stripped),
// where extensionless specifiers do not resolve. Vitest resolves it either way.
import { DEFAULT_MATRIX } from '../../shared/permissionsMatrix.ts'

let prismaClient: PrismaClient | undefined

export const getTestPrisma = (): PrismaClient => {
  prismaClient ??= new PrismaClient()
  return prismaClient
}

export const pushSchema = (databaseUrl: string): void => {
  execFileSync('pnpm', ['exec', 'prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  })
}

// Seeds the same RBAC matrix as prisma/seed.ts by importing it, not by restating it. This file used
// to keep its own hand-copied copy, which had drifted: ADMIN was missing `downloads.crud` and
// `sync.run`, so every seeded admin got 403 on reject/requeue and the downloads e2e specs failed with
// a row that simply never went away. shared/permissionsMatrix.ts exists precisely because a copy had
// already drifted once before (docs audit #38) - this was the third copy.
//
// Otherwise as prisma/seed.ts, but leaves the seeded admin ready to use
// (mustChangePassword: false) so integration/e2e tests don't have to run the change-password flow.
export const seedTestData = async (): Promise<void> => {
  const prisma = getTestPrisma()
  const bcrypt = await import('bcrypt')

  const hash = await bcrypt.hash('admin', 12)
  await prisma.user.upsert({
    where: { username: 'admin' },
    create: { username: 'admin', email: 'admin@local', passwordHash: hash, role: 'ADMIN', mustChangePassword: false },
    update: { passwordHash: hash, mustChangePassword: false, role: 'ADMIN' },
  })

  for (const [role, perms] of Object.entries(DEFAULT_MATRIX)) {
    for (const permission of perms) {
      await prisma.rolePermission.upsert({
        where: { role_permission: { role: role as 'VIEWER' | 'MANAGER' | 'ADMIN', permission } },
        create: { role: role as 'VIEWER' | 'MANAGER' | 'ADMIN', permission },
        update: {},
      })
    }
  }
}

// Truncates every non-migration table between integration tests, preserving seeded rows
// (User, RolePermission, Settings) so each test starts from a clean-but-seeded DB.
const PRESERVE_TABLES = new Set(['User', 'RolePermission', 'Settings', '_prisma_migrations'])

export const resetDb = async (): Promise<void> => {
  const prisma = getTestPrisma()
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `
  const toTruncate = tables
    .map(t => t.tablename)
    .filter(name => !PRESERVE_TABLES.has(name))
  if (toTruncate.length === 0) {return}
  const quoted = toTruncate.map(t => `"${t}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`)
}
