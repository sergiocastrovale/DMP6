import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useAfterHydration } from '../../composables/useAfterHydration'

describe('useAfterHydration', () => {
  it('waits for Nuxt hydration to finish when called during it', async () => {
    const nuxtApp = useNuxtApp()
    const fn = vi.fn()
    nuxtApp.isHydrating = true
    try {
      useAfterHydration(fn)
      await nextTick()
      expect(fn).not.toHaveBeenCalled()
      await nuxtApp.hooks.callHook('app:suspense:resolve')
      expect(fn).toHaveBeenCalledOnce()
      await nuxtApp.hooks.callHook('app:suspense:resolve')
      expect(fn).toHaveBeenCalledOnce()
    }
    finally {
      nuxtApp.isHydrating = false
    }
  })

  it('runs on mount when called inside a component after hydration', async () => {
    const fn = vi.fn()
    let calledDuringSetup = true
    await mountSuspended(defineComponent({
      setup() {
        useAfterHydration(fn)
        calledDuringSetup = fn.mock.calls.length > 0
        return () => null
      },
    }))
    expect(calledDuringSetup).toBe(false)
    expect(fn).toHaveBeenCalledOnce()
  })

  // The plugin case (plugins/presence.client.ts creates the player store): no component instance,
  // so onMounted would silently never fire - it must still run, just not synchronously.
  it('runs on the next tick when called outside any component', async () => {
    const fn = vi.fn()
    useAfterHydration(fn)
    expect(fn).not.toHaveBeenCalled()
    await nextTick()
    expect(fn).toHaveBeenCalledOnce()
  })
})
