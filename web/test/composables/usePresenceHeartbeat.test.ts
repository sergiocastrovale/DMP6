import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPresenceHeartbeat } from '../../composables/usePresenceHeartbeat'
import { PRESENCE_HEARTBEAT_MS } from '../../helpers/constants'

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

describe('createPresenceHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true })
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends an immediate heartbeat on start, with a stable per-tab clientId', () => {
    const heartbeat = createPresenceHeartbeat()
    heartbeat.start(() => null)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/me/presence')
    expect((opts as any).method).toBe('POST')
    expect((opts as any).body).toMatchObject({ trackId: null, playing: false })
    expect(typeof (opts as any).body.clientId).toBe('string')
  })

  it('reuses the same clientId across start/stop/start (sessionStorage-backed)', () => {
    const heartbeat = createPresenceHeartbeat()
    heartbeat.start(() => null)
    const firstId = (fetchMock.mock.calls[0]![1] as any).body.clientId
    heartbeat.stop()
    fetchMock.mockClear()

    heartbeat.start(() => null)
    const secondId = (fetchMock.mock.calls[0]![1] as any).body.clientId
    expect(secondId).toBe(firstId)
  })

  it('repeats the heartbeat every PRESENCE_HEARTBEAT_MS while started', () => {
    const heartbeat = createPresenceHeartbeat()
    heartbeat.start(() => null)
    fetchMock.mockClear()

    vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('stop cancels the interval', () => {
    const heartbeat = createPresenceHeartbeat()
    heartbeat.start(() => null)
    fetchMock.mockClear()

    heartbeat.stop()
    vi.advanceTimersByTime(PRESENCE_HEARTBEAT_MS * 3)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('notify sends the current track immediately, independent of the interval', () => {
    const heartbeat = createPresenceHeartbeat()
    heartbeat.start(() => null)
    fetchMock.mockClear()

    heartbeat.notify({ trackId: 't1', playing: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0]![1] as any).body).toMatchObject({ trackId: 't1', playing: true })
  })

  it('notify before start is a no-op (no clientId yet)', () => {
    const heartbeat = createPresenceHeartbeat()
    heartbeat.notify({ trackId: 't1', playing: true })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('leave sends a beacon with the clientId and clears it', () => {
    const beaconMock = vi.fn().mockReturnValue(true)
    vi.stubGlobal('navigator', { sendBeacon: beaconMock })

    const heartbeat = createPresenceHeartbeat()
    heartbeat.start(() => null)
    const clientId = (fetchMock.mock.calls[0]![1] as any).body.clientId

    heartbeat.leave()
    expect(beaconMock).toHaveBeenCalledTimes(1)
    const [url, blob] = beaconMock.mock.calls[0]!
    expect(url).toBe('/api/me/presence/leave')
    expect(blob).toBeInstanceOf(Blob)

    // A second leave after stop/no clientId should not throw or send again.
    heartbeat.stop()
    beaconMock.mockClear()
    heartbeat.leave()
    expect(beaconMock).not.toHaveBeenCalled()
    expect(clientId).toBeTruthy()
  })
})
