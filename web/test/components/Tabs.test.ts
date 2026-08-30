import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import Tabs from '../../components/Tabs.vue'
import type { TabItem } from '../../types/ui'

const TABS: TabItem[] = [
  { key: 'a', label: 'Detected', count: 3 },
  { key: 'b', label: 'Fixed', count: 0 },
  { key: 'c', label: 'History' },
]

describe('Tabs.vue', () => {
  it('carries the tablist/tab roles and marks the selected tab', async () => {
    const wrapper = await mountSuspended(Tabs, { props: { tabs: TABS, modelValue: 'a' } })
    expect(wrapper.find('[role="tablist"]').exists()).toBe(true)
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs).toHaveLength(3)
    expect(tabs[0]!.attributes('aria-selected')).toBe('true')
    expect(tabs[1]!.attributes('aria-selected')).toBe('false')
  })

  it('only the selected tab is in the tab order (roving tabindex)', async () => {
    const wrapper = await mountSuspended(Tabs, { props: { tabs: TABS, modelValue: 'b' } })
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map(t => t.attributes('tabindex'))).toEqual(['-1', '0', '-1'])
  })

  it('clicking a tab updates the model', async () => {
    const wrapper = await mountSuspended(Tabs, { props: { tabs: TABS, modelValue: 'a' } })
    await wrapper.findAll('[role="tab"]')[2]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['c']])
  })

  it('ArrowRight moves focus to the next tab, wrapping at the end', async () => {
    const wrapper = await mountSuspended(Tabs, { props: { tabs: TABS, modelValue: 'a' }, attachTo: document.body })
    const tabs = wrapper.findAll('[role="tab"]').map(t => t.element as HTMLElement)
    tabs[2]!.focus()
    await wrapper.get('[role="tablist"]').trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tabs[0])
    wrapper.unmount()
  })

  it('ArrowLeft moves focus to the previous tab, wrapping at the start', async () => {
    const wrapper = await mountSuspended(Tabs, { props: { tabs: TABS, modelValue: 'a' }, attachTo: document.body })
    const tabs = wrapper.findAll('[role="tab"]').map(t => t.element as HTMLElement)
    tabs[0]!.focus()
    await wrapper.get('[role="tablist"]').trigger('keydown', { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tabs[2])
    wrapper.unmount()
  })

  it('renders count pills, highlighted only when countHighlight is set and non-zero', async () => {
    const wrapper = await mountSuspended(Tabs, {
      props: { tabs: [{ key: 'a', label: 'Ready', count: 4, countHighlight: true }], modelValue: 'a' },
    })
    expect(wrapper.text()).toContain('4')
  })
})
