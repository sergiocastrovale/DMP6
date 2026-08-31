import { spawn } from 'node:child_process'
// Explicit extension: this file runs under Node's own ESM resolver (type-stripped), not a bundler,
// so extensionless specifiers do not resolve.
import { pushSchema, seedTestData } from '../test/setup/db.ts'

// Gives the e2e suite its own database before handing off to Playwright.
//
// Without this, `pnpm test:e2e` ran against whatever DATABASE_URL happened to be in `.env` - on a
// developer machine that is the restored production library. Two things went wrong there: the specs
// write fixture artists, users and download rows into real data, and they log in as admin/admin,
// which only exists in the seeded test database - so global-setup silently saved an unauthenticated
// session and every auth-dependent spec failed at its first locator, 30 seconds at a time, looking
// like flake rather than a missing database.
//
// CI already provisions and seeds a Postgres service and exports DATABASE_URL for it, so there it
// passes straight through. Locally it boots a throwaway container, pushes the schema and seeds the
// same admin/admin the specs expect.
const run = async (): Promise<number> => {
  let stopContainer: (() => Promise<void>) | undefined

  if (process.env.CI) {
    if (!process.env.DATABASE_URL) {
      throw new Error('CI must export DATABASE_URL for the e2e database')
    }
  }
  else {
    // DATABASE_URL_TEST lets someone point at a database they already have, the same escape hatch
    // the integration project offers.
    let databaseUrl = process.env.DATABASE_URL_TEST

    if (!databaseUrl) {
      const { PostgreSqlContainer } = await import('@testcontainers/postgresql')
      const container = await new PostgreSqlContainer('postgres:16.1').start()
      databaseUrl = container.getConnectionUri()
      stopContainer = async () => { await container.stop() }
    }

    process.env.DATABASE_URL = databaseUrl
    pushSchema(databaseUrl)
    // Creates admin/admin with mustChangePassword already cleared, plus the RBAC matrix the
    // permission specs assert against.
    await seedTestData()
  }

  // The Playwright config reads DATABASE_URL at load time and forwards it to the app server, so it
  // has to be set in this process before the child starts.
  const child = spawn('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env,
  })

  const code = await new Promise<number>((resolve) => {
    child.on('close', c => resolve(c ?? 1))
  })

  await stopContainer?.()
  return code
}

run().then(
  (code) => { process.exit(code) },
  (error) => {
    console.error(error)
    process.exit(1)
  },
)
