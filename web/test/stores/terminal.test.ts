import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTerminalStore } from '../../stores/terminal'

const fetchMock = vi.fn().mockResolvedValue({})
vi.stubGlobal('$fetch', fetchMock)

const sseResponse = (body: string, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  statusText: ok ? 'OK' : 'Error',
  body: {
    getReader: () => {
      let sent = false
      return {
        read: async () => {
          if (sent) {return { done: true, value: undefined }}
          sent = true
          return { done: false, value: new TextEncoder().encode(body) }
        },
      }
    },
  },
})

describe('useTerminalStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockClear()
  })

  it('run() streams lines and sets exitCode from the done event', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      sseResponse('data: "hello"\n\nevent: done\ndata: 0\n\n'),
    )
    vi.stubGlobal('fetch', fakeFetch)
    const store = useTerminalStore()
    await store.run('./sync', ['--only', 'X'], 'sess1')
    expect(store.lines).toEqual(['hello'])
    expect(store.exitCode).toBe(0)
    expect(store.isRunning).toBe(false)
    expect(store.currentSession).toBeNull()
  })

  it('a non-ok response records an error line and stops', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse('', false)))
    const store = useTerminalStore()
    await store.run('./sync', [], 'sess2')
    expect(store.lines[0]).toContain('Error: 500')
    expect(store.isRunning).toBe(false)
  })

  it('hasLockError is true only after a non-zero exit whose output mentions "lock held"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      sseResponse('data: "sync: lock held by another process"\n\nevent: done\ndata: 1\n\n'),
    ))
    const store = useTerminalStore()
    await store.run('./sync', [], 'sess3')
    expect(store.hasLockError).toBe(true)
  })

  it('hasLockError is false on a clean (exit 0) run even mentioning "lock held" in passing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      sseResponse('data: "no lock held issues"\n\nevent: done\ndata: 0\n\n'),
    ))
    const store = useTerminalStore()
    await store.run('./sync', [], 'sess4')
    expect(store.hasLockError).toBe(false)
  })

  it('open/close toggle isOpen', () => {
    const store = useTerminalStore()
    store.close()
    expect(store.isOpen).toBe(false)
    store.open()
    expect(store.isOpen).toBe(true)
  })

  it('hasBackground is true only when running but not open', async () => {
    const store = useTerminalStore()
    expect(store.hasBackground).toBe(false)
    store.isRunning = true
    store.isOpen = false
    expect(store.hasBackground).toBe(true)
  })
})
