import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { getTestPrisma, webRoleStatements, WEB_ROLE_PASSWORD } from '../../test/setup/db'

// scripts/sql/create_web_role.sql is what an operator runs on the NAS, and a role that is one grant too generous (or one
// too tight for the app) only shows up in production. So the file is replayed here against the migrated schema and the
// role is exercised the way the web app uses it: DML works, everything else is refused.
const admin = getTestPrisma()

const asWebRole = (): PrismaClient => {
  const url = new URL(process.env.DATABASE_URL!)
  url.username = 'dmp_web'
  url.password = WEB_ROLE_PASSWORD
  return new PrismaClient({ datasourceUrl: url.toString() })
}

describe('the dmp_web role (real Postgres)', () => {
  let web: PrismaClient

  beforeAll(async () => {
    await admin.$executeRawUnsafe('DROP OWNED BY dmp_web').catch(() => {})
    await admin.$executeRawUnsafe('DROP ROLE IF EXISTS dmp_web')
    for (const statement of webRoleStatements()) {
      await admin.$executeRawUnsafe(statement)
    }
    web = asWebRole()
  })

  afterAll(async () => {
    await web.$disconnect()
    await admin.$executeRawUnsafe('DROP OWNED BY dmp_web')
    await admin.$executeRawUnsafe('DROP ROLE dmp_web')
    await admin.$disconnect()
  })

  it('is not a superuser and cannot create roles or databases', async () => {
    const [role] = await web.$queryRaw<{ rolsuper: boolean, rolcreaterole: boolean, rolcreatedb: boolean, rolconnlimit: number }[]>`
      SELECT rolsuper, rolcreaterole, rolcreatedb, rolconnlimit FROM pg_roles WHERE rolname = current_user`
    expect(role).toEqual({ rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolconnlimit: 40 })
  })

  it('does everything the app does: read, insert, update and delete rows, and use sequences', async () => {
    const created = await web.user.create({ data: { username: 'role-test', email: 'role-test@local', passwordHash: 'x' } })
    expect(created.id).toBeGreaterThan(0)
    await web.user.update({ where: { id: created.id }, data: { role: 'MANAGER' } })
    expect((await web.user.findUniqueOrThrow({ where: { id: created.id } })).role).toBe('MANAGER')
    await web.user.delete({ where: { id: created.id } })
    expect(await web.user.count({ where: { id: created.id } })).toBe(0)
  })

  it('reads the planner estimate the random sampler relies on', async () => {
    const [row] = await web.$queryRaw<{ rows: number }[]>`SELECT reltuples::float8 AS rows FROM pg_class WHERE oid = '"LocalReleaseTrack"'::regclass`
    expect(row!.rows).toBeTypeOf('number')
  })

  it('gets a statement_timeout and an idle-in-transaction timeout from the role', async () => {
    const [row] = await web.$queryRaw<{ statement_timeout: string, idle: string }[]>`
      SELECT current_setting('statement_timeout') AS statement_timeout, current_setting('idle_in_transaction_session_timeout') AS idle`
    expect(row).toEqual({ statement_timeout: '1min', idle: '1min' })
  })

  it('cannot change the schema', async () => {
    await expect(web.$executeRawUnsafe('CREATE TABLE web_role_probe (id int)')).rejects.toThrow(/permission denied/)
    await expect(web.$executeRawUnsafe('DROP TABLE "Statistics"')).rejects.toThrow(/must be owner|permission denied/)
    await expect(web.$executeRawUnsafe('ALTER TABLE "User" ADD COLUMN probe int')).rejects.toThrow(/must be owner/)
    await expect(web.$executeRawUnsafe('TRUNCATE "User"')).rejects.toThrow(/permission denied/)
  })

  it('cannot reach the server beyond the database', async () => {
    await expect(web.$executeRawUnsafe(`COPY (SELECT 1) TO PROGRAM 'true'`)).rejects.toThrow(/permission denied|must be superuser/)
    await expect(web.$queryRawUnsafe(`SELECT pg_read_file('/etc/passwd')`)).rejects.toThrow(/permission denied/)
    await expect(web.$executeRawUnsafe('CREATE ROLE web_role_probe')).rejects.toThrow(/permission denied/)
  })

  it('cannot read the migration bookkeeping', async () => {
    await expect(web.$queryRawUnsafe('SELECT * FROM "_prisma_migrations" LIMIT 1')).rejects.toThrow(/permission denied/)
  })

  it('gets the same rights on a table a later migration creates', async () => {
    await admin.$executeRawUnsafe('CREATE TABLE web_role_later (id serial PRIMARY KEY, name text)')
    try {
      await web.$executeRawUnsafe(`INSERT INTO web_role_later (name) VALUES ('ok')`)
      expect(await web.$queryRawUnsafe<{ name: string }[]>('SELECT name FROM web_role_later')).toEqual([{ name: 'ok' }])
    }
    finally {
      await admin.$executeRawUnsafe('DROP TABLE web_role_later')
    }
  })
})
