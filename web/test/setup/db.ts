import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'
// Extensioned: e2e/with-test-db.ts loads this under Node's own ESM resolver (type-stripped),
// where extensionless specifiers do not resolve. Vitest resolves it either way.
import { DEFAULT_MATRIX } from '../../shared/permissionsMatrix.ts'

let prismaClient: PrismaClient | undefined

export const getTestPrisma = (): PrismaClient => {
  prismaClient ??= new PrismaClient()
  return prismaClient
}

// Builds the schema exactly the way ./deploy does - by replaying prisma/migrations - so the raw-SQL
// objects Prisma can't declare (the Playlist and FavoriteRelease CHECKs, the partial unique slug index,
// pattern_ops and trigram indexes) exist in every test database and a broken migration fails here
// instead of on the NAS. `databaseUrl` must be a throwaway database, never web/.env's DATABASE_URL.
export const migrateSchema = (databaseUrl: string): void => {
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
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

export const WEB_ROLE_PASSWORD = 'web-role-test-password'

// scripts/sql/create_web_role.sql is run by hand on the NAS; its contract (one statement per line-ending semicolon, no
// procedural blocks, the `:'web_password'` psql variable) is what lets the tests replay it statement by statement.
export const webRoleStatements = (password: string = WEB_ROLE_PASSWORD): string[] => {
  const sql = readFileSync(join(process.cwd(), '..', 'scripts', 'sql', 'create_web_role.sql'), 'utf8')
  return sql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*(?:\n|$)/)
    .map(statement => statement.trim().replace(/:'web_password'/g, `'${password}'`))
    .filter(Boolean)
}

// (Re)creates the least-privilege `dmp_web` role the way an operator would, and returns a connection string for it.
// Every e2e run boots the app as this role, so a query the app needs but the role does not allow fails a spec here
// instead of in production.
export const createWebRole = async (databaseUrl: string): Promise<string> => {
  const admin = new PrismaClient({ datasourceUrl: databaseUrl })
  try {
    await admin.$executeRawUnsafe('DROP OWNED BY dmp_web').catch(() => {})
    await admin.$executeRawUnsafe('DROP ROLE IF EXISTS dmp_web')
    for (const statement of webRoleStatements()) {
      await admin.$executeRawUnsafe(statement)
    }
  }
  finally {
    await admin.$disconnect()
  }
  const url = new URL(databaseUrl)
  url.username = 'dmp_web'
  url.password = WEB_ROLE_PASSWORD
  return url.toString()
}
