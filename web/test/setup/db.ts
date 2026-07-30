import { execFileSync } from 'node:child_process'
import { PrismaClient } from '@prisma/client'

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

// Mirrors prisma/seed.ts (RBAC matrix + download sources) but leaves the seeded admin ready to use
// (mustChangePassword: false) so integration/e2e tests don't have to run the change-password flow.
export const seedTestData = async (): Promise<void> => {
  const prisma = getTestPrisma()
  const bcrypt = await import('bcrypt')

  const DEFAULT_MATRIX: Record<string, string[]> = {
    VIEWER: ['play.view'],
    MANAGER: ['favorites.view', 'favorites.crud', 'playlists.view', 'playlists.crud', 'play.view', 'sync.view'],
    ADMIN: ['favorites.view', 'favorites.crud', 'playlists.view', 'playlists.crud', 'play.view', 'sync.view', 'issues.view', 'variables.edit'],
  }

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

  const sources: { name: 'RUTRACKER' | 'SLSKD'; retry: boolean; url: string | null }[] = [
    { name: 'RUTRACKER', retry: false, url: 'https://rutracker.org' },
    { name: 'SLSKD', retry: true, url: null },
  ]
  for (const s of sources) {
    await prisma.downloadSourceConfig.upsert({
      where: { name: s.name },
      create: { name: s.name, retry: s.retry, url: s.url, enabled: true },
      update: {},
    })
  }
}

// Truncates every non-migration table between integration tests, preserving seeded rows
// (User, RolePermission, DownloadSourceConfig, Settings) so each test starts from a clean-but-seeded DB.
const PRESERVE_TABLES = new Set(['User', 'RolePermission', 'DownloadSources', 'Settings', '_prisma_migrations'])

export const resetDb = async (): Promise<void> => {
  const prisma = getTestPrisma()
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  `
  const toTruncate = tables
    .map(t => t.tablename)
    .filter(name => !PRESERVE_TABLES.has(name))
  if (toTruncate.length === 0) return
  const quoted = toTruncate.map(t => `"${t}"`).join(', ')
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`)
}
