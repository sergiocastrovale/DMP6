import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useDismissable } from '../../composables/useDismissable'

const Host = defineComponent({
  setup() {
    const { open, triggerRef, toggle, close } = useDismissable()
    return () => h('div', [
      h('button', { ref: triggerRef, onClick: toggle }, 'trigger'),
      open.value ? h('div', { role: 'menu' }, 'panel') : null,
    ])
  },
})

describe('useDismissable', () => {
  it('starts closed', async () => {
    const wrapper = await mountSuspended(Host)
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })

  it('toggle opens and closes', async () => {
    const wrapper = await mountSuspended(Host)
    await wrapper.get('button').trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(true)
    await wrapper.get('button').trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })

  it('Escape closes and returns focus to the trigger', async () => {
    const wrapper = await mountSuspended(Host, { attachTo: document.body })
    await wrapper.get('button').trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(true)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('button').element)
    wrapper.unmount()
  })

  it('removes the document keydown listener on unmount', async () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const wrapper = await mountSuspended(Host)
    await wrapper.get('button').trigger('click')
    wrapper.unmount()
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    removeSpy.mockRestore()
  })
})
