import type { Role } from '@prisma/client';
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'
import { DEFAULT_MATRIX } from '../shared/permissionsMatrix'

const prisma = new PrismaClient()

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
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
