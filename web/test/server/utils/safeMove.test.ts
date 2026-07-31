import { randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('streamCopyFile', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dmp-safemove-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('copies file contents byte-for-byte without touching the source', async () => {
    const { streamCopyFile } = await import('../../../server/utils/safeMove')
    const src = join(dir, 'src.txt')
    const dest = join(dir, 'dest.txt')
    await writeFile(src, 'hello world')

    await streamCopyFile(src, dest)

    expect((await readFile(dest, 'utf8'))).toBe('hello world')
    await expect(access(src)).resolves.toBeUndefined() // source untouched by the copy itself
  })
})

describe('safeMoveFile', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dmp-safemove-'))
    vi.resetModules()
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
    vi.doUnmock('node:fs/promises')
  })

  it('is a no-op when src equals dest', async () => {
    const { safeMoveFile } = await import('../../../server/utils/safeMove')
    const src = join(dir, 'same.txt')
    await writeFile(src, 'unchanged')
    await expect(safeMoveFile(src, src)).resolves.toBeUndefined()
    expect(await readFile(src, 'utf8')).toBe('unchanged')
  })

  it('moves via rename() on the fast path (same filesystem) - source is gone, dest has the content', async () => {
    const { safeMoveFile } = await import('../../../server/utils/safeMove')
    const src = join(dir, 'a', 'src.txt')
    const dest = join(dir, 'b', 'dest.txt')
    await mkdir(join(dir, 'a'), { recursive: true })
    await writeFile(src, 'move me')

    await safeMoveFile(src, dest)

    expect(await readFile(dest, 'utf8')).toBe('move me')
    await expect(access(src)).rejects.toThrow()
  })

  it('falls back to streamed copy+unlink when rename() fails with EXDEV/EPERM (cross-device move)', async () => {
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      return {
        ...actual,
        rename: vi.fn().mockRejectedValue(Object.assign(new Error('cross-device'), { code: 'EXDEV' })),
      }
    })
    const { safeMoveFile } = await import('../../../server/utils/safeMove')
    const src = join(dir, 'src.txt')
    const dest = join(dir, 'dest.txt')
    await writeFile(src, 'cross device content')

    await safeMoveFile(src, dest)

    expect(await readFile(dest, 'utf8')).toBe('cross device content')
    await expect(access(src)).rejects.toThrow() // source removed via the fallback's own unlink
  })

  it('rethrows an error that is not EXDEV/EACCES/EPERM', async () => {
    vi.doMock('node:fs/promises', async () => {
      const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      return {
        ...actual,
        rename: vi.fn().mockRejectedValue(Object.assign(new Error('nope'), { code: 'ENOENT' })),
      }
    })
    const { safeMoveFile } = await import('../../../server/utils/safeMove')
    const id = randomUUID()
    await expect(safeMoveFile(join(dir, `missing-${id}`), join(dir, 'dest.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
