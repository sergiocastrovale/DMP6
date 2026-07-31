import { PrismaClient, Role } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

const DEFAULT_MATRIX: Record<Role, string[]> = {
  VIEWER: [
    'play.view'
  ],
  MANAGER: [
    'favorites.view',
    'favorites.crud',
    'playlists.view',
    'playlists.crud',
    'play.view',
    'sync.view',
    'sync.run',
    'downloads.crud',
  ],
  ADMIN: [
    'favorites.view',
    'favorites.crud',
    'playlists.view',
    'playlists.crud',
    'play.view',
    'sync.view',
    'sync.run',
    'downloads.crud',
    'issues.view',
    'variables.edit',
  ],
}

const main = async () => {
  const adminExists = await prisma.user.findFirst({ where: { role: 'ADMIN' } })
  if (!adminExists) {
    const hash = await bcrypt.hash('admin', 12)
    await prisma.user.create({
      data: {
        username: 'admin',
        email: 'admin@local',
        passwordHash: hash,
        role: 'ADMIN',
        mustChangePassword: true,
      },
    })
    console.log('Created admin user (admin/admin)')
  } else {
    console.log('Admin user already exists, skipping')
  }

  for (const [role, perms] of Object.entries(DEFAULT_MATRIX)) {
    for (const permission of perms) {
      await prisma.rolePermission.upsert({
        where: { role_permission: { role: role as Role, permission } },
        create: { role: role as Role, permission },
        update: {},
      })
    }
  }
  console.log('Default permission matrix seeded')

  // Download sources: RuTracker (no retry on miss, tried first) + Soulseek (retry, fallback).
  const sources: { name: string; retry: boolean; url: string | null }[] = [
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
  console.log('Download sources seeded')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
