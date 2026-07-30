import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFormSave } from '../../composables/useFormSave'

describe('useFormSave', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sets saving true during the call and false after', async () => {
    let resolveFn!: () => void
    const promise = new Promise<void>((resolve) => { resolveFn = resolve })
    const form = useFormSave(() => promise)
    const savePromise = form.save()
    expect(form.saving.value).toBe(true)
    resolveFn()
    await savePromise
    expect(form.saving.value).toBe(false)
  })

  it('sets saved=true on success, then resets it after 3s', async () => {
    const form = useFormSave(async () => {})
    await form.save()
    expect(form.saved.value).toBe(true)
    vi.advanceTimersByTime(3000)
    expect(form.saved.value).toBe(false)
  })

  it('captures a thrown Error message', async () => {
    const form = useFormSave(async () => { throw new Error('boom') })
    await form.save()
    expect(form.error.value).toBe('boom')
    expect(form.saved.value).toBe(false)
  })

  it('prefers e.data.message (H3/ofetch error shape) when present', async () => {
    const form = useFormSave(async () => { throw { data: { message: 'server said no' } } })
    await form.save()
    expect(form.error.value).toBe('server said no')
  })

  it('falls back to a generic message when the thrown value has no message', async () => {
    const form = useFormSave(async () => { throw {} })
    await form.save()
    expect(form.error.value).toBe('Save failed')
  })

  it('clears a previous error on the next successful save', async () => {
    let shouldFail = true
    const form = useFormSave(async () => { if (shouldFail) throw new Error('first') })
    await form.save()
    expect(form.error.value).toBe('first')
    shouldFail = false
    await form.save()
    expect(form.error.value).toBe('')
  })
})
