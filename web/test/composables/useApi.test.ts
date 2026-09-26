import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useApi } from '../../composables/useApi'
import { useToastStore } from '../../stores/toast'

describe('useApi', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('run resolves true and stays quiet on success', async () => {
    const api = useApi()
    expect(await api.run(async () => 'ok', 'Could not do it')).toBe(true)
    expect(useToastStore().toasts).toHaveLength(0)
  })

  it('run toasts the server message on failure and resolves false', async () => {
    const api = useApi()
    const ok = await api.run(async () => { throw Object.assign(new Error('x'), { data: { message: 'Track is already in this playlist' } }) }, 'Could not do it')
    expect(ok).toBe(false)
    expect(useToastStore().toasts.map(t => t.message)).toEqual(['Track is already in this playlist'])
  })

  it('run falls back to the caller wording', async () => {
    await useApi().run(async () => { throw Object.assign(new Error('[POST] /api/x: 500'), { name: 'FetchError' }) }, 'Could not favorite the track')
    expect(useToastStore().toasts.map(t => t.message)).toEqual(['Could not favorite the track'])
  })

  it('load returns the value, or null after toasting', async () => {
    const api = useApi()
    expect(await api.load(async () => [1, 2], 'Could not load')).toEqual([1, 2])
    expect(await api.load(async () => { throw new Error('nope') }, 'Could not load')).toBeNull()
    expect(useToastStore().toasts.map(t => t.message)).toEqual(['nope'])
  })

  it('an aborted request is not reported', async () => {
    const api = useApi()
    expect(await api.run(async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }) }, 'Could not do it')).toBe(false)
    expect(useToastStore().toasts).toHaveLength(0)
  })
})
