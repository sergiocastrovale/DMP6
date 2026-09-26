import { spawn } from 'node:child_process'
import { setResponseHeaders } from 'h3'
import type { H3Event } from 'h3'
import { parseExitLine, stripAnsi } from '~/server/utils/terminalCommand'

// One implementation of the server-sent-event plumbing the terminal, merge and mosaic streams all need: headers
// (including X-Accel-Buffering, which stops a reverse proxy holding the stream back until it "fills"), a periodic
// comment ping so an idle stream is not dropped by an intermediary, and writes that are safe after the client left.
export const SSE_HEARTBEAT_MS = 20_000

export interface SseStream {
  // `data: <json string>` - what every consumer's store expects for a plain log line.
  send: (line: string) => void
  sendEvent: (name: string, data: string) => void
  // `event: done` with an exit code, then ends the response. Idempotent.
  done: (code: number) => void
  // Verbatim bytes, for relaying another SSE stream untouched.
  raw: (chunk: Buffer) => void
  // Runs once if the client disconnects before `done` was called.
  onClose: (cb: () => void) => void
  isOpen: () => boolean
}

// heartbeatMs 0 turns the ping off (a relayed stream must not have comments spliced into it).
export const openSse = (event: H3Event, { heartbeatMs = SSE_HEARTBEAT_MS }: { heartbeatMs?: number } = {}): SseStream => {
  setResponseHeaders(event, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  const res = event.node.res
  let open = true
  const closeHandlers: (() => void)[] = []

  const heartbeat = heartbeatMs > 0
    ? setInterval(() => {
      if (open) {
        res.write(': ping\n\n')
      }
    }, heartbeatMs)
    : null
  heartbeat?.unref()

  const stop = () => {
    open = false
    if (heartbeat) {clearInterval(heartbeat)}
  }

  event.node.req.on('close', () => {
    if (!open) {return}
    stop()
    for (const cb of closeHandlers) {cb()}
  })

  return {
    send: (line) => {
      if (open) {res.write(`data: ${JSON.stringify(line)}\n\n`)}
    },
    raw: (chunk) => {
      if (open) {res.write(chunk)}
    },
    sendEvent: (name, data) => {
      if (open) {res.write(`event: ${name}\ndata: ${data}\n\n`)}
    },
    done: (code) => {
      if (!open) {return}
      stop()
      res.write(`event: done\ndata: ${code}\n\n`)
      res.end()
    },
    onClose: (cb) => {
      closeHandlers.push(cb)
    },
    isOpen: () => open,
  }
}

// Follows a tmux session's log file (`tail -f`) into an open stream until the run's exit sentinel appears (or the client
// leaves). `replayLines` replays only the end of the file first - a long ./index log is tens of MB.
export const streamLogAsSse = (sse: SseStream, logFile: string, { replayLines }: { replayLines?: number } = {}): Promise<void> =>
  new Promise<void>((resolve) => {
    const tail = spawn('tail', [...(replayLines === undefined ? [] : ['-n', String(replayLines)]), '-f', logFile])
    let finished = false

    const finish = (code: number | null) => {
      if (finished) {return}
      finished = true
      tail.kill('SIGTERM')
      if (code !== null) {sse.done(code)}
      resolve()
    }

    tail.stdout.on('data', (chunk: Buffer) => {
      for (const line of stripAnsi(chunk.toString()).split('\n')) {
        if (!line) {continue}
        const exitCode = parseExitLine(line)
        if (exitCode !== null) {
          finish(exitCode)
          return
        }
        sse.send(line)
      }
    })

    tail.on('error', (err) => {
      sse.send(`Error: ${err.message}`)
      finish(1)
    })

    sse.onClose(() => finish(null))
  })
