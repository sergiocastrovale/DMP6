import type { TestProject } from 'vitest/node'
import { pushSchema, seedTestData } from './db'

// Runs once before the `integration` project. Boots an ephemeral Postgres (testcontainers) unless
// DATABASE_URL_TEST is already set (CI provides one via a `postgres` service), pushes the schema,
// seeds RBAC + admin, and exposes DATABASE_URL to every integration test file.
export default async function setup(_project: TestProject): Promise<() => Promise<void>> {
  process.env.MONITOR_PRIMARY = 'false'
  process.env.SESSION_SECRET = 'test-session-secret-fixed-for-determinism'
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'test'

  let stop: (() => Promise<void>) | undefined

  let databaseUrl = process.env.DATABASE_URL_TEST

  if (!databaseUrl) {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql')
    const container = await new PostgreSqlContainer('postgres:16.1').start()
    databaseUrl = container.getConnectionUri()
    stop = async () => { await container.stop() }
  }

  process.env.DATABASE_URL = databaseUrl
  process.env.DATABASE_URL_TEST = databaseUrl

  pushSchema(databaseUrl)
  await seedTestData()

  return async () => {
    if (stop) await stop()
  }
}
