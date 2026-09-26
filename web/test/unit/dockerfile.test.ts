import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The production image is not built in CI, so its pins are checked here instead.
const root = join(process.cwd(), '..')
const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8')

describe('Dockerfile pins', () => {
  it('installs exactly the Prisma CLI version the lockfile resolves', () => {
    const installed = JSON.parse(readFileSync(join(process.cwd(), 'node_modules/prisma/package.json'), 'utf8')).version as string
    const pinned = dockerfile.match(/npm install -g prisma@(\S+)/)?.[1]

    expect(pinned).toBe(installed)
  })

  it('runs both Node stages on a supported release (22+; Node 20 reached end of life in April 2026)', () => {
    const majors = [...dockerfile.matchAll(/^FROM node:(\d+)/gm)].map(m => Number(m[1]))
    expect(majors).toHaveLength(2)
    for (const major of majors) {
      expect(major).toBeGreaterThanOrEqual(22)
    }
  })

  it('builds and runs on the same Node major', () => {
    const majors = new Set([...dockerfile.matchAll(/^FROM node:(\d+)/gm)].map(m => m[1]))
    expect(majors.size).toBe(1)
  })

  it('the container healthcheck uses the deep probe, so a dead database pool turns it unhealthy', () => {
    expect(dockerfile).toMatch(/HEALTHCHECK[\s\S]*\/api\/health\?deep=1/)
  })
})
