import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPlayEventTracker } from '../../composables/usePlayEventTracker'

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

describe('createPlayEventTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ id: 'e1' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('opens an event on start with the given trackId/source/duration', async () => {
    const tracker = createPlayEventTracker()
    await tracker.start('t1', 'QUEUE', 200)
    expect(fetchMock).toHaveBeenCalledWith('/api/play-events', {
      method: 'POST',
      body: { trackId: 't1', source: 'QUEUE', duration: 200 },
    })
  })

  it('ignores seek jumps (a non-positive or >=2s delta) - no progress patch from a seek alone', async () => {
    const tracker = createPlayEventTracker()
    await tracker.start('t1', 'QUEUE', 200)
    fetchMock.mockClear()

    tracker.onTimeUpdate(0.25, 200) // first real tick, small forward delta, well under the threshold
    expect(fetchMock).not.toHaveBeenCalled()

    tracker.onTimeUpdate(150, 200) // user seeked forward 150s - not real playback time
    expect(fetchMock).not.toHaveBeenCalled()

    tracker.onTimeUpdate(10, 200) // seeked backward - negative delta
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends counted:true exactly once, the moment shouldScrobble crosses its threshold', async () => {
    const tracker = createPlayEventTracker()
    await tracker.start('t1', 'QUEUE', 200) // duration 200 -> threshold at currentTime > 100
    fetchMock.mockClear()

    for (let t = 0.25; t <= 100.25; t += 0.25) {
      tracker.onTimeUpdate(t, 200)
    }
    const countedCalls = fetchMock.mock.calls.filter(([, opts]) => (opts as any)?.body?.counted === true)
    expect(countedCalls).toHaveLength(1)
    expect(countedCalls[0]![0]).toBe('/api/play-events/e1')
  })

  it('finish before counted sends skipped:true', async () => {
    const tracker = createPlayEventTracker()
    await tracker.start('t1', 'QUEUE', 200)
    for (let t = 0.25; t <= 5; t += 0.25) {
      tracker.onTimeUpdate(t, 200) // real-time ticks (0.25s deltas), well under the 100s threshold
    }
    fetchMock.mockClear()

    tracker.finish('changed')
    expect(fetchMock).toHaveBeenCalledWith('/api/play-events/e1', {
      method: 'PATCH',
      body: { listenedSeconds: 5, ended: true, skipped: true },
    })
  })

  it('finish after counted sends skipped:false', async () => {
    const tracker = createPlayEventTracker()
    await tracker.start('t1', 'QUEUE', 200)
    for (let t = 0.25; t <= 150.25; t += 0.25) {
      tracker.onTimeUpdate(t, 200)
    }
    fetchMock.mockClear()

    tracker.finish('changed')
    const [, opts] = fetchMock.mock.calls[0]!
    expect((opts as any).body.skipped).toBe(false)
  })

  it('finish is a no-op once the event is already closed', async () => {
    const tracker = createPlayEventTracker()
    await tracker.start('t1', 'QUEUE', 200)
    tracker.finish('changed')
    fetchMock.mockClear()

    tracker.finish('changed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('starting a new track finishes the still-open previous event first', async () => {
    const tracker = createPlayEventTracker()
    fetchMock.mockResolvedValueOnce({ id: 'e1' })
    await tracker.start('t1', 'QUEUE', 200)
    fetchMock.mockClear()

    fetchMock.mockResolvedValueOnce({ id: 'e2' })
    await tracker.start('t2', 'QUEUE', 200)

    expect(fetchMock).toHaveBeenCalledWith('/api/play-events/e1', {
      method: 'PATCH',
      body: { listenedSeconds: 0, ended: true, skipped: true },
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/play-events', {
      method: 'POST',
      body: { trackId: 't2', source: 'QUEUE', duration: 200 },
    })
  })
})
