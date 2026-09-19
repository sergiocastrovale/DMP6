import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

// A response whose body starts streaming fine (ok: true) but whose reader.read() then rejects mid-
// stream - exactly what a dropped connection (e.g. the QUIC error that motivated this) looks like to
// streamSSE(), as opposed to a clean non-ok HTTP response.
const sseDroppedResponse = () => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  body: {
    getReader: () => ({
      read: async () => { throw new Error('network error') },
    }),
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

  it('runSequence() runs every stage back to back when nothing stops it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse('event: done\ndata: 0\n\n')))
    const store = useTerminalStore()

    await store.runSequence([
      { command: './index', args: ['--overwrite'], session: 'seq' },
      { command: './sync', args: ['--overwrite'], session: 'seq' },
    ])

    const bodies = (globalThis.fetch as any).mock.calls.map((c: any[]) => JSON.parse(c[1].body).command)
    expect(bodies).toEqual(['./index', './sync'])
  })

  it('runSequence() tracks stageIndex/stageTotal while running and clears both when done', async () => {
    const seen: Array<[number | null, number | null]> = []
    const fakeFetch = vi.fn().mockImplementation(async () => {
      seen.push([store.stageIndex, store.stageTotal])
      return sseResponse('event: done\ndata: 0\n\n')
    })
    vi.stubGlobal('fetch', fakeFetch)
    const store = useTerminalStore()

    await store.runSequence([
      { command: './delete', args: ['X', '--y'], session: 'seq4' },
      { command: './index', args: ['--overwrite'], session: 'seq4' },
      { command: './sync', args: ['--overwrite'], session: 'seq4' },
    ])

    expect(seen).toEqual([[1, 3], [2, 3], [3, 3]])
    expect(store.stageIndex).toBeNull()
    expect(store.stageTotal).toBeNull()
  })

  it('runSequence() clears stageIndex/stageTotal when stopped mid-sequence', async () => {
    const fakeFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/terminal/stop') {return { ok: true }}
      await store.stop()
      return sseResponse('event: done\ndata: 0\n\n')
    })
    vi.stubGlobal('fetch', fakeFetch)
    const store = useTerminalStore()

    await store.runSequence([
      { command: './delete', args: ['X', '--y'], session: 'seq5' },
      { command: './index', args: ['--overwrite'], session: 'seq5' },
    ])

    expect(store.stageIndex).toBeNull()
    expect(store.stageTotal).toBeNull()
  })

  // Stopping stage 1 used to only abort its SSE: run() resolved, stage 2 fired anyway, and the user
  // who pressed Stop got the rest of the rebuild (plus a 409 from the still-unfinished session log).
  it('runSequence() skips the remaining stages once stop() is called', async () => {
    const fakeFetch = vi.fn().mockImplementation(async (url: string) => {
      if (url === '/api/terminal/stop') {return { ok: true }}
      await useTerminalStore().stop()
      return sseResponse('event: done\ndata: 0\n\n')
    })
    vi.stubGlobal('fetch', fakeFetch)
    const store = useTerminalStore()

    await store.runSequence([
      { command: './delete', args: ['X', '--y'], session: 'seq2' },
      { command: './index', args: ['--overwrite'], session: 'seq2' },
      { command: './sync', args: ['--overwrite'], session: 'seq2' },
    ])

    const commands = fakeFetch.mock.calls
      .filter((c: any[]) => c[0] === '/api/terminal/run')
      .map((c: any[]) => JSON.parse(c[1].body).command)
    expect(commands).toEqual(['./delete'])
  })

  it('a stop only kills its own sequence - the next one runs in full', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse('event: done\ndata: 0\n\n')))
    const store = useTerminalStore()
    await store.stop()

    await store.runSequence([
      { command: './index', args: [], session: 'seq3' },
      { command: './sync', args: [], session: 'seq3' },
    ])

    const commands = (globalThis.fetch as any).mock.calls
      .filter((c: any[]) => c[0] === '/api/terminal/run')
      .map((c: any[]) => JSON.parse(c[1].body).command)
    expect(commands).toEqual(['./index', './sync'])
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

  it('unlockAndRerun() clears the lock then re-runs the last command/args/session', async () => {
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce(sseResponse('event: done\ndata: 1\n\n')) // rejected run (lock held)
      .mockResolvedValueOnce({ ok: true }) // /api/terminal/unlock, from unlockAndRerun
      .mockResolvedValueOnce(sseResponse('event: done\ndata: 0\n\n')) // successful rerun
    vi.stubGlobal('fetch', fakeFetch)
    const store = useTerminalStore()

    await store.run('./delete', ['Damageplan', '--y'], 'dmp-delete')
    expect(store.exitCode).toBe(1)

    await store.unlockAndRerun()

    const runCalls = fakeFetch.mock.calls.filter(c => c[0] === '/api/terminal/run')
    expect(runCalls).toHaveLength(2)
    expect(JSON.parse(runCalls[1]![1].body)).toEqual({
      command: './delete',
      args: ['Damageplan', '--y'],
      session: 'dmp-delete',
    })
    expect(store.exitCode).toBe(0)
  })

  it('unlockAndRerun() only clears the lock when there is no prior run to retry', async () => {
    const fakeFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fakeFetch)
    const store = useTerminalStore()

    await store.unlockAndRerun()

    expect(fakeFetch.mock.calls.filter(c => c[0] === '/api/terminal/run')).toHaveLength(0)
    expect(store.lines).toContain('Lock cleared.')
  })

  it('unlockAndRerun() also retries a runStream operation (e.g. merge), not just run()', async () => {
    const fakeFetch = vi.fn()
      .mockResolvedValueOnce(sseResponse('event: done\ndata: 1\n\n')) // rejected merge (lock held)
      .mockResolvedValueOnce({ ok: true }) // /api/terminal/unlock, from unlockAndRerun
      .mockResolvedValueOnce(sseResponse('event: done\ndata: 0\n\n')) // successful retry
    vi.stubGlobal('fetch', fakeFetch)
    const store = useTerminalStore()

    await store.runStream('/api/downloads/merge-stream', { ids: ['abc'] }, 'merge', 'Merging…')
    expect(store.exitCode).toBe(1)

    await store.unlockAndRerun()

    const mergeCalls = fakeFetch.mock.calls.filter(c => c[0] === '/api/downloads/merge-stream')
    expect(mergeCalls).toHaveLength(2)
    expect(JSON.parse(mergeCalls[1]![1].body)).toEqual({ ids: ['abc'] })
    expect(store.exitCode).toBe(0)
  })

  // Regression coverage for the disappearing-terminal bug: a dropped connection used to be treated
  // identically to "nothing was ever running" (currentSession/currentCommand nulled, exitCode left
  // null), collapsing isSidebarVisible/isToastVisible to false even though the job was still running
  // server-side.
  describe('connection drop handling', () => {
    // run()'s tail call to maybeAutoReconnect() means a persistently-dropped fetch keeps retrying
    // (real backoff delays) unless time is faked - these tests only care about the state right after
    // streamSSE()'s own catch/finally, before any retry fires, so they fake timers, advance 0ms (just
    // enough to flush microtasks through that point) to snapshot state, then let the run() promise
    // resolve cleanly to avoid leaking a pending timer/promise into the next test.
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('a reader.read() rejection sets connectionLost and keeps currentSession populated', async () => {
      const fakeFetch = vi.fn().mockResolvedValue(sseDroppedResponse())
      vi.stubGlobal('fetch', fakeFetch)
      const store = useTerminalStore()

      const runPromise = store.run('./sync', [], 'sess-drop')
      await vi.advanceTimersByTimeAsync(0)

      expect(store.connectionLost).toBe(true)
      expect(store.isRunning).toBe(false)
      expect(store.exitCode).toBeNull()
      expect(store.currentSession).toBe('sess-drop')
      expect(store.currentCommand).toBe('./sync')

      await store.stop()
      await vi.advanceTimersByTimeAsync(30000)
      await runPromise
    })

    it('isSidebarVisible/isToastVisible stay true on connectionLost even though exitCode is null', async () => {
      const fakeFetch = vi.fn().mockResolvedValue(sseDroppedResponse())
      vi.stubGlobal('fetch', fakeFetch)
      const store = useTerminalStore()

      const runPromise = store.run('./sync', [], 'sess-drop-vis')
      await vi.advanceTimersByTimeAsync(0)
      // streamSSE() resets viewMode to 'toast' at the start of every run - expand() has to happen
      // after the drop, same as a user clicking into the sidebar once it's already showing.
      store.expand()

      expect(store.exitCode).toBeNull()
      expect(store.isSidebarVisible).toBe(true)
      store.minimize()
      expect(store.isToastVisible).toBe(true)

      await store.stop()
      await vi.advanceTimersByTimeAsync(30000)
      await runPromise
    })

    it('stop() still targets the right session after a drop (currentSession was preserved)', async () => {
      const fakeFetch = vi.fn().mockResolvedValue(sseDroppedResponse())
      vi.stubGlobal('fetch', fakeFetch)
      const store = useTerminalStore()

      const runPromise = store.run('./sync', [], 'sess-drop-stop')
      await vi.advanceTimersByTimeAsync(0)
      fakeFetch.mockClear()
      fakeFetch.mockResolvedValue({ ok: true })
      await store.stop()

      expect(fakeFetch).toHaveBeenCalledWith('/api/terminal/stop', expect.objectContaining({
        body: JSON.stringify({ session: 'sess-drop-stop' }),
      }))

      await vi.advanceTimersByTimeAsync(30000)
      await runPromise
    })

    it('a non-ok HTTP response still clears currentSession (never started, nothing to reconnect to)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse('', false)))
      const store = useTerminalStore()

      await store.run('./sync', [], 'sess-nonok')

      expect(store.connectionLost).toBe(false)
      expect(store.currentSession).toBeNull()
    })
  })

  describe('auto-reconnect after a drop', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('automatically reconnects after the first backoff delay', async () => {
      const fakeFetch = vi.fn()
        .mockResolvedValueOnce(sseDroppedResponse())
        .mockResolvedValueOnce(sseResponse('event: done\ndata: 0\n\n'))
      vi.stubGlobal('fetch', fakeFetch)
      const store = useTerminalStore()

      const runPromise = store.run('./sync', [], 'sess-auto')
      await vi.advanceTimersByTimeAsync(20000)
      await runPromise

      const urls = fakeFetch.mock.calls.map(c => c[0])
      expect(urls).toEqual(['/api/terminal/run', '/api/terminal/reconnect'])
      expect(JSON.parse(fakeFetch.mock.calls[1]![1].body)).toEqual({ session: 'sess-auto' })
      expect(store.connectionLost).toBe(false)
      expect(store.exitCode).toBe(0)
    })

    it('gives up after exhausting the backoff list, leaving connectionLost true', async () => {
      const fakeFetch = vi.fn().mockResolvedValue(sseDroppedResponse())
      vi.stubGlobal('fetch', fakeFetch)
      const store = useTerminalStore()

      const runPromise = store.run('./sync', [], 'sess-exhaust')
      for (let i = 0; i < 8; i++) {
        await vi.advanceTimersByTimeAsync(20000)
      }
      await runPromise

      const reconnectCalls = fakeFetch.mock.calls.filter(c => c[0] === '/api/terminal/reconnect')
      expect(reconnectCalls.length).toBeGreaterThan(0)
      expect(store.connectionLost).toBe(true)
    })

    // The anti-race guard: stoppedGeneration alone only protects runSequence()'s stage loop, not a
    // retry kicked off after streamSSE() has already resolved - this is what stops Stop from getting
    // raced by a reconnect attempt already in flight.
    it('stop() during the backoff window cancels the pending auto-reconnect', async () => {
      const fakeFetch = vi.fn().mockResolvedValue(sseDroppedResponse())
      vi.stubGlobal('fetch', fakeFetch)
      const store = useTerminalStore()

      const runPromise = store.run('./sync', [], 'sess-race')
      await vi.advanceTimersByTimeAsync(0)
      expect(store.connectionLost).toBe(true)

      fakeFetch.mockResolvedValue({ ok: true })
      await store.stop()

      await vi.advanceTimersByTimeAsync(30000)
      await runPromise

      const reconnectCalls = fakeFetch.mock.calls.filter(c => c[0] === '/api/terminal/reconnect')
      expect(reconnectCalls).toHaveLength(0)
      expect(store.connectionLost).toBe(false)
    })
  })

  describe('orphan session recovery', () => {
    it('checkForOrphanSessions does nothing while already attached to a session', async () => {
      const store = useTerminalStore()
      store.currentSession = 'already-running'
      const dollarFetch = vi.fn()
      vi.stubGlobal('$fetch', dollarFetch)

      await store.checkForOrphanSessions()

      expect(dollarFetch).not.toHaveBeenCalled()
    })

    it('autoReconnectOrphan reconnects to the first session GET /api/terminal/sessions reports', async () => {
      const dollarFetch = vi.fn().mockResolvedValue({ sessions: [{ session: 'rebuild-al-jolson', startedAt: null }] })
      vi.stubGlobal('$fetch', dollarFetch)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse('event: done\ndata: 0\n\n')))
      const store = useTerminalStore()

      await store.autoReconnectOrphan()

      expect(dollarFetch).toHaveBeenCalledWith('/api/terminal/sessions')
      expect(store.exitCode).toBe(0)
    })

    it('skips a session this tab recently stopped itself', async () => {
      const dollarFetch = vi.fn().mockResolvedValue({ sessions: [{ session: 'sess-stopped', startedAt: null }] })
      vi.stubGlobal('$fetch', dollarFetch)
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
      const store = useTerminalStore()
      store.currentSession = 'sess-stopped'
      await store.stop()
      store.currentSession = null

      await store.checkForOrphanSessions()

      expect(store.orphanSessions).toEqual([])
    })
  })
})
