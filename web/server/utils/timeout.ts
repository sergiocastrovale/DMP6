// Deadlines for work that must be CANCELLED, not just abandoned.
//
// The monitor loop's old `withTimeout` was `Promise.race([work, timer])`: on timeout the race rejected and the
// caller marked the download FAILED and purged its source files - while the losing promise (a slow relocate or
// ffmpeg transcode) kept running, moving files into a staging folder for a row that was already failed and racing
// the purge. Its timer was never cleared either.
//
// `withDeadline` instead hands the work an AbortSignal and, on timeout, aborts it and WAITS for the work to
// actually stop (bounded by `graceMs`) before reporting the timeout. So by the time the caller cleans up, nothing
// is still writing.
export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`)
    this.name = 'TimeoutError'
  }
}

export interface DeadlineOptions {
  label?: string
  // How long to wait for the aborted work to wind down before giving up on it (work that ignores the signal).
  graceMs?: number
}

export const withDeadline = async <T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
  { label = 'operation', graceMs = 15_000 }: DeadlineOptions = {},
): Promise<T> => {
  const controller = new AbortController()
  let timedOut = false
  let expire: () => void = () => {}
  // Rejects when the deadline fires, so work that never looks at its signal (or never settles) still ends the wait.
  const expired = new Promise<never>((_resolve, reject) => {
    expire = () => reject(new TimeoutError(label, ms))
  })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new TimeoutError(label, ms))
    expire()
  }, ms)

  const running = work(controller.signal)
  try {
    return await Promise.race([running, expired])
  }
  catch (error) {
    if (!timedOut) {throw error}
    // The deadline fired: let the (aborted) work finish unwinding before the caller cleans up after it.
    await Promise.race([
      running.catch(() => {}),
      new Promise<void>(resolve => setTimeout(resolve, graceMs)),
    ])
    throw new TimeoutError(label, ms)
  }
  finally {
    clearTimeout(timer)
  }
}

// True for the error an aborted operation throws (fetch/execFile AbortError, signal.throwIfAborted's reason).
export const isAbortLike = (error: unknown): boolean =>
  error instanceof TimeoutError
  || (typeof error === 'object' && error !== null && ['AbortError', 'TimeoutError'].includes((error as { name?: string }).name ?? ''))
  || (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ABORT_ERR')
