import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, utimesSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureTerminalDir, pruneTerminalFiles, terminalDir, terminalLogPath, terminalMetaPath, terminalScriptPath } from '../../../server/utils/terminalPaths'

let root: string
const saved = { LOG_DIR: process.env.LOG_DIR, PROJECT_ROOT: process.env.PROJECT_ROOT }

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'termpaths-'))
  process.env.LOG_DIR = root
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  if (saved.LOG_DIR === undefined) {delete process.env.LOG_DIR} else {process.env.LOG_DIR = saved.LOG_DIR}
  if (saved.PROJECT_ROOT === undefined) {delete process.env.PROJECT_ROOT} else {process.env.PROJECT_ROOT = saved.PROJECT_ROOT}
})

describe('terminal paths', () => {
  it('live under the app log directory, never /tmp', () => {
    expect(terminalDir()).toBe(join(root, 'terminal'))
    expect(terminalLogPath('dmp-index')).toBe(join(root, 'terminal', 'dmp-dmp-index.log'))
    expect(terminalScriptPath('s')).toBe(join(root, 'terminal', 'dmp-s.sh'))
    expect(terminalMetaPath('s')).toBe(join(root, 'terminal', 'dmp-s.json'))
  })

  it('fall back to <PROJECT_ROOT>/data/logs/terminal without LOG_DIR', () => {
    delete process.env.LOG_DIR
    process.env.PROJECT_ROOT = '/app'
    expect(terminalDir()).toBe('/app/data/logs/terminal')
  })

  it('creates the directory owner-only', async () => {
    await ensureTerminalDir()
    expect(existsSync(terminalDir())).toBe(true)
    expect(statSync(terminalDir()).mode & 0o077).toBe(0)
  })
})

describe('pruneTerminalFiles', () => {
  const touch = (name: string, ageDays: number) => {
    const file = join(terminalDir(), name)
    writeFileSync(file, 'x')
    const t = new Date(Date.now() - ageDays * 86400000)
    utimesSync(file, t, t)
    return file
  }

  it('removes terminal files older than the cutoff and keeps recent ones', async () => {
    await ensureTerminalDir()
    const old = touch('dmp-old.log', 20)
    const oldScript = touch('dmp-old.sh', 20)
    const recent = touch('dmp-recent.log', 1)

    const removed = await pruneTerminalFiles()

    expect(removed).toBe(2)
    expect(existsSync(old)).toBe(false)
    expect(existsSync(oldScript)).toBe(false)
    expect(existsSync(recent)).toBe(true)
  })

  it('only ever touches dmp-*.log|sh|json - anything else in the directory is left alone', async () => {
    await ensureTerminalDir()
    const stranger = touch('notes.txt', 400)
    const wrongShape = touch('dmp-x.bak', 400)

    expect(await pruneTerminalFiles()).toBe(0)
    expect(existsSync(stranger)).toBe(true)
    expect(existsSync(wrongShape)).toBe(true)
  })

  it('is a no-op (not an error) when the directory does not exist yet', async () => {
    expect(await pruneTerminalFiles()).toBe(0)
  })
})
