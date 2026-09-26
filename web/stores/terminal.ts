import { defineStore } from 'pinia'
import { useGlobalStore } from '~/stores/global'
import { isAbortError } from '~/helpers/functions'
import { appendTerminalLine, parseDoneExitCode, parseSseEvents } from '~/helpers/sse'
import { RECONNECT_BACKOFF_MS, RECONNECT_STOP_GUARD_MS } from '~/helpers/constants'
import type { TerminalSessionSummary, TerminalSessionsResponse } from '~/types/scan'

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export const useTerminalStore = defineStore('terminal', () => {
  const viewMode = ref<'toast' | 'sidebar'>('toast')
  const dismissed = ref(false)
  const isRunning = ref(false)
  const lines = ref<string[]>([])
  const exitCode = ref<number | null>(null)
  const currentSession = ref<string | null>(null)
  const currentCommand = ref<string | null>(null)
  // Set when streamSSE's fetch/reader throws something other than an intentional abort (a dropped
  // network connection, e.g. the QUIC error that motivated this) - kept separate from exitCode
  // because "connection lost" isn't "the job finished", and from isRunning because the job is (as
  // far as we know) still running server-side, we just can't see it. Read by isSidebarVisible/
  // isToastVisible so the panel stays up instead of silently vanishing, and drives
  // maybeAutoReconnect() below.
  const connectionLost = ref(false)
  // Sessions GET /api/terminal/sessions reports as alive+unfinished that this tab has no memory of
  // starting (a fresh page load, or a reload after a drop) - populated by checkForOrphanSessions(),
  // consumed by autoReconnectOrphan() and by RealTimeStatus.vue's manual fallback.
  const orphanSessions = ref<TerminalSessionSummary[]>([])
  // Survives streamSSE's finally block (which nulls currentSession/currentCommand) so a lock-blocked
  // run - script-backed (run/runSequence) or SSE-backed (runStream, e.g. merge) - can be retried after
  // Force Unlock without the caller re-supplying its command/args/session or url/body.
  const lastRetry = ref<(() => Promise<void>) | null>(null)
  // 1-based index of the running stage within runSequence()'s steps, and the total stage count - null
  // outside a sequence (or for a single run()). Lets the UI show "Rebuilding: index (2/4)" instead of
  // reading a mid-sequence stage's own "Done." banner as the whole sequence having finished.
  const stageIndex = ref<number | null>(null)
  const stageTotal = ref<number | null>(null)

  let abortController: AbortController | null = null

  // Multi-stage scans (delete → index → sync) run as one sequence with one generation number. Stop()
  // marks the current generation dead so the remaining stages are skipped: without it, aborting the
  // SSE of stage 1 just resolved run() and stage 2 started anyway - the user pressed Stop and got the
  // rest of the rebuild regardless.
  let sequenceGeneration = 0
  let stoppedGeneration = -1

  // A narrower, session-keyed guard for the new auto-reconnect paths (maybeAutoReconnect, orphan
  // recovery) - stoppedGeneration only protects runSequence()'s stage loop, not a retry loop kicked
  // off after streamSSE() has already resolved. stop() records the session the instant it's called
  // (synchronously, before any await), so the guard is in place regardless of network timing -
  // covering both "Stop clicked while connectionLost is already showing" and "Stop clicked during the
  // backoff wait". Not persisted across a real page reload: a reload right after Stop reconnecting to
  // confirm it actually landed is correct behavior, not a bug (see terminal.test.ts).
  const recentlyStoppedAt = new Map<string, number>()
  const wasRecentlyStopped = (session: string): boolean => {
    const t = recentlyStoppedAt.get(session)
    return t !== undefined && Date.now() - t < RECONNECT_STOP_GUARD_MS
  }

  async function streamSSE(url: string, body: Record<string, any>) {
    lines.value = []
    exitCode.value = null
    isRunning.value = true
    dismissed.value = false
    viewMode.value = 'toast'
    connectionLost.value = false

    abortController = new AbortController()
    let aborted = false
    let nonOk = false

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortController.signal,
      })

      if (!response.ok) {
        nonOk = true
        lines.value.push(`Error: ${response.status} ${response.statusText}`)
        isRunning.value = false
        return
      }

      const reader = response.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) {break}

        buffer += decoder.decode(value, { stream: true })
        const { events, remainder } = parseSseEvents(buffer)
        buffer = remainder

        for (const { event: eventType, data } of events) {
          if (eventType === 'done') {
            exitCode.value = parseDoneExitCode(data)
          } else if (data) {
            let text: string
            try {
              text = JSON.parse(data)
            } catch {
              text = data
            }
            if (typeof text === 'string') {
              appendTerminalLine(lines.value, text)
            } else {
              lines.value.push(text)
            }
          }
        }
      }
    } catch (e) {
      if (isAbortError(e)) {
        aborted = true
      } else {
        lines.value.push(`Error: ${(e as Error).message}`)
        connectionLost.value = true
      }
    } finally {
      isRunning.value = false
      // Only clear the session once we know nothing is left to reconnect to: the run genuinely
      // concluded (exitCode set by a `done` event), was explicitly aborted, or never started (non-ok
      // response). A bare connection-lost error keeps currentSession/currentCommand populated - that's
      // what lets Stop still target the right session and lets maybeAutoReconnect() below know what to
      // reconnect to.
      if (aborted || nonOk || exitCode.value !== null) {
        currentSession.value = null
        currentCommand.value = null
      }
      abortController = null
      useGlobalStore().refresh()
    }
  }

  // Bounded, backed-off retry after a dropped connection. `attempt` is how many retries have already
  // been used getting here (0 the first time it's called, straight after the original run/reconnect
  // failed) - RECONNECT_BACKOFF_MS[attempt] is the delay before trying retry number attempt+1. Not
  // wired into runStream() (e.g. merge): there is no reconnect-equivalent resume endpoint for
  // non-tmux SSE operations, and auto-retrying a non-idempotent op would be wrong.
  async function maybeAutoReconnect(session: string, attempt = 0) {
    if (!connectionLost.value) {return}
    if (wasRecentlyStopped(session)) {
      connectionLost.value = false
      return
    }
    if (attempt >= RECONNECT_BACKOFF_MS.length) {return}
    await delay(RECONNECT_BACKOFF_MS[attempt]!)
    if (wasRecentlyStopped(session)) {
      connectionLost.value = false
      return
    }
    if (!connectionLost.value) {return}
    await reconnect(session, attempt + 1)
  }

  async function run(command: string, args: string[], session?: string) {
    const resolvedSession = session ?? `dmp-${command.replace('./', '')}`
    currentSession.value = resolvedSession
    currentCommand.value = command
    lastRetry.value = () => run(command, args, resolvedSession)
    await streamSSE('/api/terminal/run', { command, args, session: resolvedSession })
    await maybeAutoReconnect(resolvedSession)
  }

  // Runs stages back to back, stopping at the first one the user cancels. `stopOnFailure` also stops
  // at the first stage that exits non-zero (a multi-disc delete must not carry on past a failed disc).
  async function runSequence(
    steps: Array<{ command: string, args: string[], session?: string }>,
    options: { stopOnFailure?: boolean } = {},
  ) {
    const gen = ++sequenceGeneration
    stageTotal.value = steps.length
    try {
      for (const [i, step] of steps.entries()) {
        if (stoppedGeneration === gen) {return}
        stageIndex.value = i + 1
        await run(step.command, step.args, step.session)
        if (stoppedGeneration === gen) {return}
        if (options.stopOnFailure && exitCode.value !== 0) {return}
      }
    }
    finally {
      if (sequenceGeneration === gen) {
        stageIndex.value = null
        stageTotal.value = null
      }
    }
  }

  // `attempt` is passed through from maybeAutoReconnect when this is an automatic retry (so a failure
  // here continues the same backoff sequence rather than restarting it); defaults to 0 for a fresh
  // manual reconnect (e.g. RealTimeStatus.vue's button, or autoReconnectOrphan() below).
  async function reconnect(session: string, attempt = 0) {
    currentSession.value = session
    await streamSSE('/api/terminal/reconnect', { session })
    await maybeAutoReconnect(session, attempt)
  }

  // Generic SSE streamer for non-script operations (e.g. merge) that want their output in the terminal.
  async function runStream(url: string, body: Record<string, any>, session: string, label: string) {
    currentSession.value = session
    currentCommand.value = label
    lastRetry.value = () => runStream(url, body, session, label)
    return streamSSE(url, body)
  }

  function expand() {
    viewMode.value = 'sidebar'
  }

  function minimize() {
    viewMode.value = 'toast'
  }

  // Stops THIS session only. Does not touch the global scan lock - stop.post.ts only clears it when
  // the recorded PID is verified to belong to this session's process, so an unrelated session (or a
  // different machine/container sharing the same DB) never gets its lock wiped out from under it.
  // Use the "Force unlock" button (hasLockError below) to explicitly clear a lock reported as stuck.
  async function stop() {
    stoppedGeneration = sequenceGeneration
    if (currentSession.value) {
      // Recorded synchronously, before any await, so the guard is in place the instant Stop is
      // clicked regardless of network timing - see recentlyStoppedAt's comment above.
      recentlyStoppedAt.set(currentSession.value, Date.now())
      try {
        await fetch('/api/terminal/stop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session: currentSession.value }),
        })
      }
      catch { /* best-effort - abort SSE regardless */ }
    }
    abortController?.abort()
  }

  const hasLockError = computed(() =>
    !isRunning.value
    && exitCode.value !== null
    && exitCode.value !== 0
    && lines.value.some(l => typeof l === 'string' && l.includes('lock held')),
  )

  async function stopAndClose() {
    if (isRunning.value) {
      await stop()
    }
    dismissed.value = true
  }

  const isSidebarVisible = computed(() =>
    viewMode.value === 'sidebar' && !dismissed.value
    && (isRunning.value || exitCode.value !== null || connectionLost.value),
  )

  const isToastVisible = computed(() =>
    viewMode.value === 'toast' && !dismissed.value
    && (isRunning.value || hasLockError.value || connectionLost.value),
  )

  // Orphan recovery for a store instance that never saw the run start (a fresh page load, a reload
  // after a drop, or the drop happened on a page that wasn't even watching it). No-ops while already
  // attached to something - checkForOrphanSessions() only matters when idle.
  async function checkForOrphanSessions() {
    if (isRunning.value || currentSession.value) {return}
    try {
      const res = await $fetch<TerminalSessionsResponse>('/api/terminal/sessions')
      orphanSessions.value = res.sessions.filter(s => !wasRecentlyStopped(s.session))
    }
    catch { /* best-effort */ }
  }

  async function autoReconnectOrphan() {
    await checkForOrphanSessions()
    if (isRunning.value || currentSession.value) {return}
    const first = orphanSessions.value[0]
    if (first) {
      await reconnect(first.session)
    }
  }

  // Clears the DB scan lock without touching whatever process holds it - the other script keeps
  // running. Caller decides what runs next; see unlockAndRerun() for the "run alongside it" path.
  async function unlock() {
    try {
      await fetch('/api/scan/unlock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signalOwn: false }) })
      lines.value.push('Lock cleared.')
    }
    catch {
      lines.value.push('Failed to clear lock.')
    }
  }

  // User-confirmed override for a lock-blocked run: clears the lock (the other script is left running
  // untouched) then re-issues whatever just got rejected - a script run or a runStream operation like
  // merge - so it now starts in parallel with whatever still holds - or held - the lock. Collisions are
  // the accepted risk of pressing this; gated behind an explicit confirm dialog in TerminalForceUnlock.vue.
  async function unlockAndRerun() {
    const retry = lastRetry.value
    await unlock()
    if (retry) {
      await retry()
    }
  }

  return {
    viewMode,
    dismissed,
    isRunning,
    lines,
    exitCode,
    currentSession,
    currentCommand,
    connectionLost,
    orphanSessions,
    stageIndex,
    stageTotal,
    hasLockError,
    isSidebarVisible,
    isToastVisible,
    run,
    runSequence,
    runStream,
    reconnect,
    expand,
    minimize,
    stop,
    stopAndClose,
    unlock,
    unlockAndRerun,
    checkForOrphanSessions,
    autoReconnectOrphan,
  }
})
