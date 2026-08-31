import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import BulkBar from '../../../components/ui/BulkBar.vue'

describe('ui/BulkBar.vue', () => {
  it('is hidden when nothing is selected and shown once count > 0', async () => {
    const wrapper = await mountSuspended(BulkBar, { props: { count: 0 } })
    expect(wrapper.find('div').exists()).toBe(false)

    await wrapper.setProps({ count: 3 })
    expect(wrapper.text()).toContain('3 selected')
  })

  it('reads as a bare count with no label, which is what every screen wants', async () => {
    const wrapper = await mountSuspended(BulkBar, { props: { count: 1 } })
    expect(wrapper.text()).toContain('1 selected')
    expect(wrapper.text()).not.toContain('row')
  })

  it('pluralizes an explicit label', async () => {
    const one = await mountSuspended(BulkBar, { props: { count: 1, label: 'artist' } })
    expect(one.text()).toContain('1 artist selected')

    const many = await mountSuspended(BulkBar, { props: { count: 2, label: 'artist' } })
    expect(many.text()).toContain('2 artists selected')
  })

  it('renders slot content', async () => {
    const wrapper = await mountSuspended(BulkBar, {
      props: { count: 1 },
      slots: { default: '<button class="action">Do it</button>' },
    })
    expect(wrapper.find('.action').exists()).toBe(true)
  })

  it('sits in flow above the table rather than pinned to the viewport', async () => {
    // The whole point of the rewrite: a `fixed` bar put the selection count a screen away from the
    // checkboxes it counts, and needed sidebar-width and terminal-drawer bookkeeping to avoid
    // covering them.
    const wrapper = await mountSuspended(BulkBar, { props: { count: 1 } })
    const classes = wrapper.get('div').classes()
    expect(classes).not.toContain('fixed')
    expect(classes).toContain('rounded-lg')
    expect(classes).toContain('bg-amber-400/20')
  })
})
