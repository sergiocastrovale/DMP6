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

  it('run() always seeds viewMode to toast and clears dismissed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse('event: done\ndata: 0\n\n')))
    const store = useTerminalStore()
    store.expand()
    store.dismissed = true

    await store.run('./sync', [], 'sess-seed')

    expect(store.viewMode).toBe('toast')
    expect(store.dismissed).toBe(false)
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

  it('expand/minimize toggle viewMode', () => {
    const store = useTerminalStore()
    store.minimize()
    expect(store.viewMode).toBe('toast')
    store.expand()
    expect(store.viewMode).toBe('sidebar')
  })

  it('isSidebarVisible is true while running or after completion, false once dismissed', () => {
    const store = useTerminalStore()
    store.expand()
    expect(store.isSidebarVisible).toBe(false)
    store.isRunning = true
    expect(store.isSidebarVisible).toBe(true)
    store.isRunning = false
    store.exitCode = 0
    expect(store.isSidebarVisible).toBe(true)
    store.dismissed = true
    expect(store.isSidebarVisible).toBe(false)
  })

  it('isToastVisible is true while running or while a lock error is showing, false once dismissed', () => {
    const store = useTerminalStore()
    store.minimize()
    expect(store.isToastVisible).toBe(false)
    store.isRunning = true
    expect(store.isToastVisible).toBe(true)
    store.isRunning = false
    store.exitCode = 1
    store.lines = ['sync: lock held by another process']
    expect(store.isToastVisible).toBe(true)
    store.dismissed = true
    expect(store.isToastVisible).toBe(false)
  })

  it('stopAndClose() stops a running session and always dismisses', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fakeFetch)
    const store = useTerminalStore()
    store.currentSession = 'sess-stop-close'
    store.isRunning = true

    await store.stopAndClose()

    expect(fakeFetch).toHaveBeenCalledWith('/api/terminal/stop', expect.objectContaining({ method: 'POST' }))
    expect(store.dismissed).toBe(true)
  })

  it('stopAndClose() just dismisses when nothing is running', async () => {
    const fakeFetch = vi.fn()
    vi.stubGlobal('fetch', fakeFetch)
    const store = useTerminalStore()

    await store.stopAndClose()

    expect(fakeFetch).not.toHaveBeenCalled()
    expect(store.dismissed).toBe(true)
  })

  it('stop() only hits /api/terminal/stop, never force-clears the lock itself', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fakeFetch)
    const store = useTerminalStore()
    store.currentSession = 'sess-stop'
    await store.stop()
    expect(fakeFetch).toHaveBeenCalledTimes(1)
    expect(fakeFetch).toHaveBeenCalledWith('/api/terminal/stop', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ session: 'sess-stop' }),
    }))
  })

  it('reconnect() resumes streaming an existing session', async () => {
    const fakeFetch = vi.fn().mockResolvedValue(sseResponse('data: "resumed"\n\n'))
    vi.stubGlobal('fetch', fakeFetch)
    const store = useTerminalStore()

    await store.reconnect('sess-reconnect')

    expect(fakeFetch).toHaveBeenCalledWith('/api/terminal/reconnect', expect.objectContaining({
      body: JSON.stringify({ session: 'sess-reconnect' }),
    }))
    expect(store.lines).toEqual(['resumed'])
  })

  it('unlock() clears the lock and appends a confirmation line', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    const store = useTerminalStore()

    await store.unlock()

    expect(store.lines).toContain('Lock cleared.')
  })

  it('unlock() appends a failure line when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const store = useTerminalStore()

    await store.unlock()

    expect(store.lines).toContain('Failed to clear lock.')
  })
})
