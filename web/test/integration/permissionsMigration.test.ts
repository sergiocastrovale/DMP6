import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { getTestPrisma, resetDb } from '../setup/db'

// The issues.fix / issues.admin grant migration must preserve who could write before it. Runs the real
// migration SQL against a hand-built RolePermission table (the seeded matrix is truncated first).
const prisma = getTestPrisma()

describe('20260926000600_issues_fix_permissions', () => {
  afterAll(async () => {
    await resetDb()
    await prisma.$disconnect()
  })

  it('grants the write permissions to exactly the non-admin roles that had issues.view, and is idempotent', async () => {
    await prisma.rolePermission.deleteMany({})
    await prisma.rolePermission.createMany({
      data: [
        { role: 'VIEWER', permission: 'play.view' },
        { role: 'MANAGER', permission: 'issues.view' },
        { role: 'ADMIN', permission: 'issues.view' },
      ],
    })

    const sql = readFileSync('prisma/migrations/20260926000600_issues_fix_permissions/migration.sql', 'utf8')
    const statements = sql.split('\n').filter(l => !l.startsWith('--')).join('\n').split(';').map(s => s.trim()).filter(Boolean)
    for (const stmt of [...statements, ...statements]) {
      await prisma.$executeRawUnsafe(stmt)
    }

    const rows = await prisma.rolePermission.findMany({ where: { permission: { in: ['issues.fix', 'issues.admin'] } } })
    expect(rows.map(r => `${r.role}:${r.permission}`).sort()).toEqual(['MANAGER:issues.admin', 'MANAGER:issues.fix'])
  })
})
