import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useHistoryDismiss } from '../../composables/useHistoryDismiss'

const Host = defineComponent({
  props: { onClose: { type: Function, required: true } },
  setup(props) {
    useHistoryDismiss(() => props.onClose())
    return () => h('div', 'sheet')
  },
})

describe('useHistoryDismiss', () => {
  it('pushes a history sentinel on mount, preserving existing history.state', async () => {
    history.replaceState({ existing: 'router-state' }, '')
    const pushSpy = vi.spyOn(history, 'pushState')
    await mountSuspended(Host, { props: { onClose: () => {} } })
    expect(pushSpy).toHaveBeenCalledWith({ existing: 'router-state', dmpSheetOpen: true }, '')
    pushSpy.mockRestore()
  })

  it('a popstate event calls close', async () => {
    const onClose = vi.fn()
    await mountSuspended(Host, { props: { onClose } })
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('unmounting pops its own sentinel without re-triggering close', async () => {
    const onClose = vi.fn()
    const backSpy = vi.spyOn(history, 'back').mockImplementation(() => {
      // jsdom/happy-dom fire popstate synchronously from back() - this is exactly the case
      // poppingSelf exists to swallow, since the listener is still attached at this point.
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    const wrapper = await mountSuspended(Host, { props: { onClose } })
    wrapper.unmount()
    expect(backSpy).toHaveBeenCalledOnce()
    expect(onClose).not.toHaveBeenCalled()
    backSpy.mockRestore()
  })

  it('removes the popstate listener on unmount', async () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const wrapper = await mountSuspended(Host, { props: { onClose: () => {} } })
    wrapper.unmount()
    expect(removeSpy).toHaveBeenCalledWith('popstate', expect.any(Function))
    removeSpy.mockRestore()
  })
})
