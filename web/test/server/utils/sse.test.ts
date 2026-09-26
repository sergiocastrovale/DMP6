import { EventEmitter } from 'node:events'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openSse, streamLogAsSse } from '../../../server/utils/sse'

const fakeEvent = () => {
  const writes: string[] = []
  const headers: Record<string, string> = {}
  const req = new EventEmitter()
  const res = Object.assign(new EventEmitter(), {
    ended: false,
    write: (chunk: string | Buffer) => { writes.push(String(chunk)); return true },
    end: () => { res.ended = true },
    setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = String(v) },
    getHeader: (k: string) => headers[k.toLowerCase()],
    getHeaders: () => headers,
  })
  return { event: { node: { req, res }, _handled: false } as never, writes, headers, req, res }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('openSse', () => {
  it('sets stream headers including X-Accel-Buffering', () => {
    const { event, headers } = fakeEvent()
    openSse(event)
    expect(headers['content-type']).toBe('text/event-stream')
    expect(headers['x-accel-buffering']).toBe('no')
    expect(headers['cache-control']).toBe('no-cache')
  })

  it('writes lines as JSON data frames and named events verbatim', () => {
    const { event, writes } = fakeEvent()
    const sse = openSse(event)
    sse.send('hello "world"')
    sse.sendEvent('progress', '{"n":1}')
    expect(writes).toEqual(['data: "hello \\"world\\""\n\n', 'event: progress\ndata: {"n":1}\n\n'])
  })

  it('done writes the exit event once, ends the response and silences later writes', () => {
    const { event, writes, res } = fakeEvent()
    const sse = openSse(event)
    sse.done(3)
    sse.done(4)
    sse.send('late')
    expect(writes).toEqual(['event: done\ndata: 3\n\n'])
    expect(res.ended).toBe(true)
    expect(sse.isOpen()).toBe(false)
  })

  it('pings on the heartbeat until done', () => {
    vi.useFakeTimers()
    const { event, writes } = fakeEvent()
    const sse = openSse(event, { heartbeatMs: 20_000 })
    vi.advanceTimersByTime(40_000)
    expect(writes.filter(w => w === ': ping\n\n')).toHaveLength(2)
    sse.done(0)
    vi.advanceTimersByTime(60_000)
    expect(writes.filter(w => w === ': ping\n\n')).toHaveLength(2)
  })

  it('heartbeatMs 0 never pings, and raw relays bytes untouched', () => {
    vi.useFakeTimers()
    const { event, writes } = fakeEvent()
    const sse = openSse(event, { heartbeatMs: 0 })
    sse.raw(Buffer.from('data: x\n\n'))
    vi.advanceTimersByTime(120_000)
    expect(writes).toEqual(['data: x\n\n'])
  })

  it('runs close handlers once when the client leaves before done, and stops writing', () => {
    const { event, writes, req } = fakeEvent()
    const sse = openSse(event)
    const cb = vi.fn()
    sse.onClose(cb)
    req.emit('close')
    req.emit('close')
    sse.send('late')
    expect(cb).toHaveBeenCalledTimes(1)
    expect(writes).toEqual([])
  })

  it('does not treat the close that follows a normal done as a disconnect', () => {
    const { event, req } = fakeEvent()
    const sse = openSse(event)
    const cb = vi.fn()
    sse.onClose(cb)
    sse.done(0)
    req.emit('close')
    expect(cb).not.toHaveBeenCalled()
  })
})

describe('streamLogAsSse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dmp-sse-'))

  it('replays the tail, follows new lines, and ends on the exit sentinel', async () => {
    const log = join(dir, 'run.log')
    writeFileSync(log, 'one\ntwo\nthree\n')
    const { event, writes } = fakeEvent()
    const sse = openSse(event, { heartbeatMs: 0 })
    const finished = streamLogAsSse(sse, log, { replayLines: 2 })
    await vi.waitFor(() => expect(writes.join('')).toContain('three'))
    appendFileSync(log, 'four\nDMP_EXIT:7\n')
    await finished
    const out = writes.join('')
    expect(out).not.toContain('"one"')
    expect(out).toContain('data: "two"')
    expect(out).toContain('data: "four"')
    expect(out.endsWith('event: done\ndata: 7\n\n')).toBe(true)
    rmSync(dir, { recursive: true, force: true })
  })
})
