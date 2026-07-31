// Pure SSE-framing logic shared by stores/terminal.ts and stores/mosaic.ts, both of which read a
// fetch() ReadableStream and split it into `event: <type>\ndata: <payload>\n\n` frames by hand.
// Extracted here so the framing/parsing itself is unit-testable without a real stream or fetch.

export interface SseEvent {
  event: string
  data: string
}

// Splits a growing text buffer on the `\n\n` frame separator. The trailing partial frame (if any) is
// returned as `remainder` - the caller should prepend it to the next decoded chunk before calling
// again, exactly like `buffer = parts.pop()` in the original store code.
export function parseSseEvents(buffer: string): { events: SseEvent[], remainder: string } {
  const parts = buffer.split('\n\n')
  const remainder = parts.pop() ?? ''
  const events: SseEvent[] = []
  for (const part of parts) {
    let event = 'message'
    let data = ''
    for (const line of part.split('\n')) {
      if (line.startsWith('event: ')) {event = line.slice(7)}
      else if (line.startsWith('data: ')) {data = line.slice(6)}
    }
    events.push({ event, data })
  }
  return { events, remainder }
}

// `event: done` carries the process exit code as its data payload. Non-numeric/missing -> 0.
export function parseDoneExitCode(data: string): number {
  return parseInt(data, 10) || 0
}

// Terminal-specific line accumulation: a `\r`-prefixed line is a progress update that overwrites the
// previous line if it was also a progress line, instead of appending a new one. Mutates `lines`.
export function appendTerminalLine(lines: string[], text: string): void {
  if (text.startsWith('\r')) {
    const cleaned = text.slice(1)
    const last = lines[lines.length - 1]
    if (lines.length > 0 && typeof last === 'string' && last.startsWith('\r')) {
      lines[lines.length - 1] = '\r' + cleaned
    }
    else {
      lines.push('\r' + cleaned)
    }
  }
  else {
    lines.push(text)
  }
}
