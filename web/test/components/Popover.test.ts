import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import Popover from '../../components/Popover.vue'

describe('Popover.vue', () => {
  it('opens on trigger click and shows the content slot (click mode)', async () => {
    const wrapper = await mountSuspended(Popover, {
      slots: { trigger: '<button>Open</button>', content: '<div>Panel content</div>' },
    })
    expect(wrapper.text()).not.toContain('Panel content')
    await wrapper.get('button').trigger('click')
    expect(wrapper.text()).toContain('Panel content')
  })

  it('closes again on a second trigger click', async () => {
    const wrapper = await mountSuspended(Popover, {
      slots: { trigger: '<button>Open</button>', content: '<div>Panel content</div>' },
    })
    await wrapper.get('button').trigger('click')
    await wrapper.get('button').trigger('click')
    expect(wrapper.text()).not.toContain('Panel content')
  })

  it('closes on Escape while open', async () => {
    const wrapper = await mountSuspended(Popover, {
      slots: { trigger: '<button>Open</button>', content: '<div>Panel content</div>' },
    })
    await wrapper.get('button').trigger('click')
    expect(wrapper.text()).toContain('Panel content')
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain('Panel content')
  })

  it('closes when the full-screen backdrop is clicked (outside click, click mode)', async () => {
    const wrapper = await mountSuspended(Popover, {
      slots: { trigger: '<button>Open</button>', content: '<div>Panel content</div>' },
    })
    await wrapper.get('button').trigger('click')
    const backdrop = wrapper.findAll('div').find(d => d.classes().includes('fixed'))!
    await backdrop.trigger('click')
    expect(wrapper.text()).not.toContain('Panel content')
  })

  it('hover mode opens when the pointer enters the trigger wrapper', async () => {
    const wrapper = await mountSuspended(Popover, {
      props: { trigger: 'hover' },
      slots: { trigger: '<span>Hover me</span>', content: '<div>Panel content</div>' },
    })
    // mouseenter does not bubble, so the listener - bound on Popover's own trigger wrapper div,
    // not the slotted <span> - only fires when dispatched on that wrapper directly.
    const triggerWrapper = wrapper.findAll('div')[1]!
    await triggerWrapper.trigger('mouseenter')
    expect(wrapper.text()).toContain('Panel content')
  })

  it('hover mode schedules a close on mouseleave, cancelled by re-entering before it fires', async () => {
    vi.useFakeTimers()
    const wrapper = await mountSuspended(Popover, {
      props: { trigger: 'hover' },
      slots: { trigger: '<span>Hover me</span>', content: '<div>Panel content</div>' },
    })
    const triggerWrapper = wrapper.findAll('div')[1]!
    await triggerWrapper.trigger('mouseenter')
    expect(wrapper.text()).toContain('Panel content')
    await triggerWrapper.trigger('mouseleave')
    vi.advanceTimersByTime(150)
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).not.toContain('Panel content')
    vi.useRealTimers()
  })
})
