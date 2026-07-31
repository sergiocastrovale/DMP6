import { describe, expect, it } from 'vitest'
import { appendTerminalLine, parseDoneExitCode, parseSseEvents } from '../../helpers/sse'

describe('parseSseEvents', () => {
  it('parses a single complete frame', () => {
    const { events, remainder } = parseSseEvents('event: message\ndata: hello\n\n')
    expect(events).toEqual([{ event: 'message', data: 'hello' }])
    expect(remainder).toBe('')
  })

  it('defaults event type to "message" when absent', () => {
    const { events } = parseSseEvents('data: hi\n\n')
    expect(events).toEqual([{ event: 'message', data: 'hi' }])
  })

  it('parses multiple frames in one buffer', () => {
    const { events } = parseSseEvents('data: a\n\ndata: b\n\n')
    expect(events.map(e => e.data)).toEqual(['a', 'b'])
  })

  it('holds back an incomplete trailing frame as remainder', () => {
    const { events, remainder } = parseSseEvents('data: complete\n\nevent: partial\ndata: incomp')
    expect(events).toEqual([{ event: 'message', data: 'complete' }])
    expect(remainder).toBe('event: partial\ndata: incomp')
  })

  it('feeding the remainder back in on the next chunk completes the frame (streaming simulation)', () => {
    const first = parseSseEvents('event: done\nda')
    expect(first.events).toEqual([])
    const second = parseSseEvents(first.remainder + 'ta: 0\n\n')
    expect(second.events).toEqual([{ event: 'done', data: '0' }])
  })

  it('returns empty events and the whole buffer as remainder when no frame is complete', () => {
    const { events, remainder } = parseSseEvents('data: nope')
    expect(events).toEqual([])
    expect(remainder).toBe('data: nope')
  })

  it('handles an empty buffer', () => {
    expect(parseSseEvents('')).toEqual({ events: [], remainder: '' })
  })
})

describe('parseDoneExitCode', () => {
  it('parses a numeric exit code', () => {
    expect(parseDoneExitCode('0')).toBe(0)
    expect(parseDoneExitCode('1')).toBe(1)
    expect(parseDoneExitCode('130')).toBe(130)
  })

  it('defaults to 0 for missing/non-numeric data', () => {
    expect(parseDoneExitCode('')).toBe(0)
    expect(parseDoneExitCode('not-a-number')).toBe(0)
  })
})

describe('appendTerminalLine', () => {
  it('appends a normal line', () => {
    const lines: string[] = []
    appendTerminalLine(lines, 'hello')
    expect(lines).toEqual(['hello'])
  })

  it('pushes a new \\r-prefixed progress line when the last line was not one', () => {
    const lines = ['normal']
    appendTerminalLine(lines, '\rProgress: 10%')
    expect(lines).toEqual(['normal', '\rProgress: 10%'])
  })

  it('overwrites the last line when both are \\r-prefixed progress updates', () => {
    const lines: string[] = []
    appendTerminalLine(lines, '\rProgress: 10%')
    appendTerminalLine(lines, '\rProgress: 50%')
    expect(lines).toEqual(['\rProgress: 50%'])
  })

  it('a normal line after a progress line starts a fresh entry (no more overwriting)', () => {
    const lines: string[] = []
    appendTerminalLine(lines, '\rProgress: 10%')
    appendTerminalLine(lines, 'Done.')
    appendTerminalLine(lines, '\rProgress: 0%')
    expect(lines).toEqual(['\rProgress: 10%', 'Done.', '\rProgress: 0%'])
  })

  it('handles the very first line being a progress line', () => {
    const lines: string[] = []
    appendTerminalLine(lines, '\rProgress: 1%')
    expect(lines).toEqual(['\rProgress: 1%'])
  })

  it('drops the oldest line once over the cap (audit #92)', () => {
    const lines: string[] = []
    for (let i = 0; i < 5; i++) {
      appendTerminalLine(lines, `line ${i}`, 3)
    }
    expect(lines).toEqual(['line 2', 'line 3', 'line 4'])
  })

  it('overwriting the last progress line never triggers the cap eviction', () => {
    const lines = ['a', 'b', '\rProgress: 10%']
    appendTerminalLine(lines, '\rProgress: 50%', 3)
    expect(lines).toEqual(['a', 'b', '\rProgress: 50%'])
  })
})
