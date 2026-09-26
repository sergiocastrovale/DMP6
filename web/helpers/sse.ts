// Pure SSE-framing logic shared by stores/terminal.ts and stores/mosaic.ts, both of which read a
// fetch() ReadableStream and split it into `event: <type>\ndata: <payload>\n\n` frames by hand.
// Extracted here so the framing/parsing itself is unit-testable without a real stream or fetch.

import { TERMINAL_LINES_CAP } from '~/helpers/constants'
import type { SseEvent } from '~/types/common'

// Splits a growing text buffer on the `\n\n` frame separator. The trailing partial frame (if any) is
// returned as `remainder` - the caller should prepend it to the next decoded chunk before calling
// again, exactly like `buffer = parts.pop()` in the original store code.
export const parseSseEvents = (buffer: string): { events: SseEvent[], remainder: string } => {
  const parts = buffer.split('\n\n')
  const remainder = parts.pop() ?? ''
  const events: SseEvent[] = []
  for (const part of parts) {
    let event = 'message'
    let data = ''
    let hasField = false
    for (const line of part.split('\n')) {
      if (line.startsWith('event: ')) {event = line.slice(7); hasField = true}
      else if (line.startsWith('data: ')) {data = line.slice(6); hasField = true}
    }
    // A frame of only comment lines (the server's `: ping` keep-alive) carries nothing for the caller.
    if (hasField) {events.push({ event, data })}
  }
  return { events, remainder }
}

// `event: done` carries the process exit code as its data payload. Non-numeric/missing -> 0.
export const parseDoneExitCode = (data: string): number => {
  return parseInt(data, 10) || 0
}

// Terminal-specific line accumulation: a `\r`-prefixed line is a progress update that overwrites the
// previous line if it was also a progress line, instead of appending a new one. Mutates `lines`.
// Ring-buffer capped at `cap` - a long-running command (e.g. a full ./index pass) can stream tens of
// thousands of lines; growing `lines` unbounded balloons the reactive array and every re-render that
// scans it (audit #92). Overwriting the last line never grows the array, so only the two push cases
// need the cap check.
export const appendTerminalLine = (lines: string[], text: string, cap = TERMINAL_LINES_CAP): void => {
  if (text.startsWith('\r')) {
    const cleaned = text.slice(1)
    const last = lines[lines.length - 1]
    if (lines.length > 0 && typeof last === 'string' && last.startsWith('\r')) {
      lines[lines.length - 1] = '\r' + cleaned
      return
    }
    lines.push('\r' + cleaned)
  }
  else {
    lines.push(text)
  }
  if (lines.length > cap) {lines.shift()}
}
