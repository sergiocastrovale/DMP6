import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToastStore } from '../../stores/toast'

describe('useToastStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('push adds a toast with an incrementing id and returns that id', () => {
    const store = useToastStore()
    const id1 = store.push('info', 'first')
    const id2 = store.push('info', 'second')
    expect(id2).toBe(id1 + 1)
    expect(store.toasts.map(t => t.message)).toEqual(['first', 'second'])
  })

  it('error/success/info convenience methods set the right kind', () => {
    const store = useToastStore()
    store.error('e')
    store.success('s')
    store.info('i')
    expect(store.toasts.map(t => t.kind)).toEqual(['error', 'success', 'info'])
  })

  it('dismiss removes a toast by id', () => {
    const store = useToastStore()
    const id = store.push('info', 'to remove')
    store.dismiss(id)
    expect(store.toasts).toEqual([])
  })

  it('auto-dismisses after the default 6000ms', () => {
    const store = useToastStore()
    store.push('info', 'auto')
    expect(store.toasts).toHaveLength(1)
    vi.advanceTimersByTime(6000)
    expect(store.toasts).toHaveLength(0)
  })

  it('a custom ms=0 disables auto-dismiss', () => {
    const store = useToastStore()
    store.push('info', 'sticky', 0)
    vi.advanceTimersByTime(100_000)
    expect(store.toasts).toHaveLength(1)
  })

  it('respects a custom auto-dismiss duration', () => {
    const store = useToastStore()
    store.push('info', 'fast', 100)
    vi.advanceTimersByTime(99)
    expect(store.toasts).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(store.toasts).toHaveLength(0)
  })

  it('cancels every pending auto-dismiss timer when the store is disposed', () => {
    const store = useToastStore()
    store.push('info', 'pending')

    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    store.$dispose()

    expect(clearSpy).toHaveBeenCalled()
    clearSpy.mockRestore()
  })
})
