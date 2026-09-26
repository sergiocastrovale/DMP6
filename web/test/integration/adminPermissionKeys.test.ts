import { afterAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { getTestPrisma, resetDb } from '../setup/db'
import { ALL_PERMISSIONS, DEFAULT_MATRIX } from '../../shared/permissionsMatrix'

const prisma = getTestPrisma()

describe('20260926003200_admin_permission_keys', () => {
  afterAll(async () => {
    await resetDb()
    await prisma.$disconnect()
  })

  it('keeps MANAGER able to use the album mosaic, and is idempotent', async () => {
    await prisma.rolePermission.deleteMany({})
    const sql = readFileSync('prisma/migrations/20260926003200_admin_permission_keys/migration.sql', 'utf8')
    const statements = sql.split('\n').filter(l => !l.startsWith('--')).join('\n').split(';').map(s => s.trim()).filter(Boolean)
    for (const stmt of [...statements, ...statements]) {
      await prisma.$executeRawUnsafe(stmt)
    }

    const rows = await prisma.rolePermission.findMany()
    expect(rows.map(r => `${r.role}:${r.permission}`)).toEqual(['MANAGER:labs.mosaic'])
  })

  it('declares every admin-surface key, and only MANAGER gets labs.mosaic by default', () => {
    for (const key of ['users.manage', 'permissions.manage', 'playlists.generate', 'labs.mosaic', 'terminal.control']) {
      expect(ALL_PERMISSIONS).toContain(key)
    }
    expect(DEFAULT_MATRIX.MANAGER).toContain('labs.mosaic')
    expect(DEFAULT_MATRIX.VIEWER).not.toContain('labs.mosaic')
    for (const key of ['users.manage', 'permissions.manage', 'playlists.generate', 'terminal.control']) {
      expect(DEFAULT_MATRIX.MANAGER).not.toContain(key)
    }
  })
})
