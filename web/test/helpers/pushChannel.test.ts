import { describe, expect, it, vi } from 'vitest'
import { createPushChannel } from '../../helpers/pushChannel'
import type { PushEventSource } from '../../helpers/pushChannel'

const fakeSource = () => {
  const listeners: Record<string, () => void> = {}
  const source: PushEventSource & { emit: (type: string) => void, readyStateValue: number } = {
    onopen: null,
    onerror: null,
    readyStateValue: 0,
    get readyState() { return this.readyStateValue },
    addEventListener: (type, listener) => { listeners[type] = listener },
    close: vi.fn(),
    emit: type => listeners[type]?.(),
  }
  return source
}

const fakeDoc = () => {
  const listeners = new Set<() => void>()
  return {
    hidden: false,
    addEventListener: (_: 'visibilitychange', l: () => void) => { listeners.add(l) },
    removeEventListener: (_: 'visibilitychange', l: () => void) => { listeners.delete(l) },
    fire: () => { for (const l of [...listeners]) { l() } },
    count: () => listeners.size,
  }
}

const setup = (docOverrides: Partial<ReturnType<typeof fakeDoc>> = {}) => {
  const source = fakeSource()
  const doc = Object.assign(fakeDoc(), docOverrides)
  const onChange = vi.fn()
  const onConnectedChange = vi.fn()
  const channel = createPushChannel({ url: '/events', onChange, onConnectedChange, createSource: () => source, doc })
  return { source, doc, onChange, onConnectedChange, channel }
}

describe('createPushChannel', () => {
  it('is connected once the stream opens, and reports each change of that', () => {
    const { source, channel, onConnectedChange } = setup()
    channel.open()
    expect(channel.connected).toBe(false)

    source.onopen!()
    expect(channel.connected).toBe(true)
    source.onerror!()
    expect(channel.connected).toBe(false)
    expect(onConnectedChange.mock.calls).toEqual([[true], [false]])
  })

  it('runs onChange for each changed event', () => {
    const { source, channel, onChange } = setup()
    channel.open()
    source.emit('changed')
    source.emit('changed')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('holds changes back while the tab is hidden and runs one read when it is visible again', () => {
    const { source, doc, channel, onChange } = setup({ hidden: true })
    channel.open()
    source.emit('changed')
    source.emit('changed')
    expect(onChange).not.toHaveBeenCalled()

    doc.hidden = false
    doc.fire()
    expect(onChange).toHaveBeenCalledTimes(1)
    doc.fire()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('does not catch up on the first open, but does after a drop and reconnect', () => {
    const { source, channel, onChange } = setup()
    channel.open()
    source.onopen!()
    expect(onChange).not.toHaveBeenCalled()

    source.onerror!()
    source.onopen!()
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('gives up on a stream the server refused, so open() can try again later', () => {
    const { source, channel, doc } = setup()
    channel.open()
    source.readyStateValue = 2
    source.onerror!()

    expect(source.close).toHaveBeenCalled()
    expect(channel.connected).toBe(false)
    expect(doc.count()).toBe(0)
  })

  it('open is idempotent and close releases everything', () => {
    const create = vi.fn(() => fakeSource())
    const doc = fakeDoc()
    const channel = createPushChannel({ url: '/events', onChange: vi.fn(), createSource: create, doc })
    channel.open()
    channel.open()
    expect(create).toHaveBeenCalledTimes(1)
    expect(doc.count()).toBe(1)

    channel.close()
    expect(doc.count()).toBe(0)
    channel.open()
    expect(create).toHaveBeenCalledTimes(2)
  })

  it('does nothing where the browser has no EventSource', () => {
    const channel = createPushChannel({ url: '/events', onChange: vi.fn(), createSource: () => null })
    expect(() => channel.open()).not.toThrow()
    expect(channel.connected).toBe(false)
  })
})
