import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectRoot, runScript, ScriptError, scriptPath, scriptsDir } from '../../../server/utils/runScript'

// Real processes: fake binaries are tiny node scripts in a temp dir, addressed through SCRIPTS_DIR exactly the way
// the Rust binaries are.
let dir: string
const saved = { SCRIPTS_DIR: process.env.SCRIPTS_DIR, PROJECT_ROOT: process.env.PROJECT_ROOT }

const fake = (name: string, body: string) => {
  const file = join(dir, name)
  writeFileSync(file, `#!/usr/bin/env node\n${body}\n`)
  chmodSync(file, 0o755)
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'runscript-'))
  process.env.SCRIPTS_DIR = dir
  process.env.PROJECT_ROOT = dir
  fake('chatty', `
    const line = 'x'.repeat(79) + '\\n'
    const total = 1_200_000 // ~96 MB - beyond the old execFile maxBuffer of 64 MB
    let i = 0
    const write = () => {
      while (i < total) {
        i++
        if (!process.stdout.write(i === total ? 'LAST LINE\\n' : line)) { process.stdout.once('drain', write); return }
      }
    }
    write()`)
  fake('ok', `console.log('one'); console.log('two')`)
  fake('fails', `console.error('Cannot start: scan lock held by index'); process.exit(3)`)
  fake('slow', `setTimeout(() => {}, 30000)`)
  fake('args', `console.log(JSON.stringify(process.argv.slice(2))); console.log(process.cwd())`)
  fake('ordered', `
    const fs = require('fs')
    fs.appendFileSync(process.argv[2], 'start ' + process.argv[3] + '\\n')
    setTimeout(() => { fs.appendFileSync(process.argv[2], 'end ' + process.argv[3] + '\\n') }, 150)`)
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  if (saved.SCRIPTS_DIR === undefined) {delete process.env.SCRIPTS_DIR} else {process.env.SCRIPTS_DIR = saved.SCRIPTS_DIR}
  if (saved.PROJECT_ROOT === undefined) {delete process.env.PROJECT_ROOT} else {process.env.PROJECT_ROOT = saved.PROJECT_ROOT}
})

describe('script location', () => {
  it('resolves SCRIPTS_DIR, falling back to PROJECT_ROOT, then the working directory', () => {
    expect(scriptPath('sync')).toBe(join(dir, 'sync'))
    delete process.env.SCRIPTS_DIR
    expect(scriptsDir()).toBe(dir)
    delete process.env.PROJECT_ROOT
    expect(projectRoot()).toBe(process.cwd())
    process.env.SCRIPTS_DIR = dir
    process.env.PROJECT_ROOT = dir
  })
})

describe('runScript', () => {
  it('completes a run whose output is far larger than execFile\'s old 64 MB maxBuffer, keeping only the tail', async () => {
    const result = await runScript('chatty', [], { tailLines: 5 })

    expect(result.code).toBe(0)
    expect(result.tail).toHaveLength(5)
    expect(result.tail[result.tail.length - 1]).toBe('LAST LINE')
  }, 60_000)

  it('passes arguments through untouched and runs in the project root', async () => {
    const { tail } = await runScript('args', ['--only', 'A;B', '--exact'])
    expect(JSON.parse(tail[0]!)).toEqual(['--only', 'A;B', '--exact'])
    expect(tail[1]).toBe(dir)
  })

  it('streams every line to onLine', async () => {
    const seen: string[] = []
    await runScript('ok', [], { onLine: l => seen.push(l) })
    expect(seen).toEqual(['one', 'two'])
  })

  it('rejects a non-zero exit with a ScriptError carrying the code and the output tail', async () => {
    const error = await runScript('fails').catch(e => e)

    expect(error).toBeInstanceOf(ScriptError)
    expect(error.code).toBe(3)
    expect(error.message).toContain('exited with code 3')
    expect(error.message).toContain('scan lock held')
    expect(error.tail.join('\n')).toMatch(/lock held/)
  })

  it('rejects clearly when the binary does not exist', async () => {
    const error = await runScript('does-not-exist').catch(e => e)
    expect(error).toBeInstanceOf(ScriptError)
    expect(error.message).toContain('failed to start does-not-exist')
  })

  it('can be aborted with a signal, killing the child', async () => {
    const controller = new AbortController()
    const pending = runScript('slow', [], { signal: controller.signal })
    setTimeout(() => controller.abort(), 100)

    const error = await pending.catch(e => e)

    expect(error).toBeInstanceOf(ScriptError)
    expect(error.message).toMatch(/killed by SIGTERM/)
  })

  it('exclusive runs never overlap - each finishes before the next starts', async () => {
    const log = join(dir, 'order.log')
    await Promise.all([
      runScript('ordered', [log, 'a'], { exclusive: true }),
      runScript('ordered', [log, 'b'], { exclusive: true }),
      runScript('ordered', [log, 'c'], { exclusive: true }),
    ])
    const lines = (await import('node:fs')).readFileSync(log, 'utf8').trim().split('\n')
    const names = lines.map(l => l.split(' ')[1])
    expect(lines.map(l => l.split(' ')[0])).toEqual(['start', 'end', 'start', 'end', 'start', 'end'])
    expect(names[0]).toBe(names[1])
    expect(names[2]).toBe(names[3])
    expect(names[4]).toBe(names[5])
  })
})
