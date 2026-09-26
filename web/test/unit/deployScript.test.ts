import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ./deploy talks to the NAS and can't be run in CI, so its ordering guarantees are pinned by reading it.
const script = readFileSync(join(process.cwd(), '..', 'deploy'), 'utf8')

describe('./deploy', () => {
  it('applies migrations from the new image BEFORE restarting the web container', () => {
    const migrate = script.indexOf('migrate deploy')
    const restart = script.indexOf('docker compose up -d web')

    expect(migrate).toBeGreaterThan(-1)
    expect(restart).toBeGreaterThan(-1)
    expect(migrate).toBeLessThan(restart)
  })

  it('migrates in a one-off container, so the old container keeps serving and a failure stops the deploy', () => {
    expect(script).toMatch(/docker compose run --rm --no-deps -T web prisma/)
    expect(script).toMatch(/^set -euo pipefail/m)
    expect(script).not.toMatch(/docker compose exec[^\n]*prisma migrate deploy/)
  })

  it('warns and asks before data-dropping migrations, but not for index changes', () => {
    expect(script).toMatch(/drop_\(dead\|column\|table\)/)
    expect(script).toContain('./backup')
  })
})
