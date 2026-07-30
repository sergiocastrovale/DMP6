import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNativeBridge } from '../../composables/useNativeBridge'

describe('useNativeBridge', () => {
  afterEach(() => {
    delete (window as unknown as { Capacitor?: unknown }).Capacitor
  })

  it('isNative is false and playback calls are no-ops when window.Capacitor is undefined (plain browser)', () => {
    const bridge = useNativeBridge()
    expect(bridge.isNative()).toBe(false)
    expect(() => bridge.startPlaybackService('title')).not.toThrow()
    expect(() => bridge.stopPlaybackService()).not.toThrow()
  })

  it('isNative reflects Capacitor.isNativePlatform() when present', () => {
    ;(window as unknown as { Capacitor: unknown }).Capacitor = { isNativePlatform: () => true }
    expect(useNativeBridge().isNative()).toBe(true)
  })

  it('startPlaybackService calls the ForegroundService plugin start() with the title', () => {
    const start = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { Capacitor: unknown }).Capacitor = {
      isNativePlatform: () => true,
      Plugins: { ForegroundService: { start, stop: vi.fn() } },
    }
    useNativeBridge().startPlaybackService('Now Playing')
    expect(start).toHaveBeenCalledWith({ title: 'Now Playing' })
  })

  it('stopPlaybackService calls the ForegroundService plugin stop()', () => {
    const stop = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { Capacitor: unknown }).Capacitor = {
      Plugins: { ForegroundService: { start: vi.fn(), stop } },
    }
    useNativeBridge().stopPlaybackService()
    expect(stop).toHaveBeenCalledOnce()
  })

  it('swallows a rejected start()/stop() promise without throwing', async () => {
    const start = vi.fn().mockRejectedValue(new Error('native error'))
    ;(window as unknown as { Capacitor: unknown }).Capacitor = {
      Plugins: { ForegroundService: { start, stop: vi.fn() } },
    }
    expect(() => useNativeBridge().startPlaybackService()).not.toThrow()
    await Promise.resolve()
  })
})
