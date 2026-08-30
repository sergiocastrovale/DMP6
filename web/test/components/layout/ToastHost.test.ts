import { mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it } from 'vitest'
import ToastHost from '../../../components/layout/ToastHost.vue'
import { useToastStore } from '../../../stores/toast'

describe('layout/ToastHost.vue', () => {
  // mountSuspended reuses the same Nuxt app (and its Pinia instance) across every test in this
  // file, so toasts pushed in one test would otherwise still be present in the next.
  beforeEach(() => {
    useToastStore().toasts.splice(0)
  })

  it('is an aria-live polite status region', async () => {
    const wrapper = await mountSuspended(ToastHost)
    const region = wrapper.get('[role="status"]')
    expect(region.attributes('aria-live')).toBe('polite')
  })

  it('renders a toast pushed onto the store, with its message', async () => {
    const toast = useToastStore()
    toast.push('success', 'Saved')
    const wrapper = await mountSuspended(ToastHost)
    expect(wrapper.text()).toContain('Saved')
  })

  it('dismissing a toast removes it from the store', async () => {
    const toast = useToastStore()
    toast.push('info', 'Copied link')
    const wrapper = await mountSuspended(ToastHost)
    expect(toast.toasts).toHaveLength(1)
    await wrapper.get('[aria-label="Dismiss"]').trigger('click')
    expect(toast.toasts).toHaveLength(0)
  })
})
