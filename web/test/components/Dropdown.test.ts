import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import Dropdown from '../../components/Dropdown.vue'

const OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'score', label: 'Match Score' },
]

describe('Dropdown.vue', () => {
  it('shows the placeholder/"All" label when nothing is selected', async () => {
    const wrapper = await mountSuspended(Dropdown, { props: { options: OPTIONS, modelValue: null } })
    expect(wrapper.get('button').text()).toContain('All')
  })

  it('shows the selected option label', async () => {
    const wrapper = await mountSuspended(Dropdown, { props: { options: OPTIONS, modelValue: 'score' } })
    expect(wrapper.get('button').text()).toContain('Match Score')
  })

  it('opens the listbox on trigger click and closes it on selection', async () => {
    const wrapper = await mountSuspended(Dropdown, { props: { options: OPTIONS, modelValue: null } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)
    const options = wrapper.findAll('[role="option"]')
    await options[1]!.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([['name']])
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('exposes aria-expanded on the trigger', async () => {
    const wrapper = await mountSuspended(Dropdown, { props: { options: OPTIONS, modelValue: null } })
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('false')
    await wrapper.get('button').trigger('click')
    expect(wrapper.get('button').attributes('aria-expanded')).toBe('true')
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const wrapper = await mountSuspended(Dropdown, { props: { options: OPTIONS, modelValue: null }, attachTo: document.body })
    const trigger = wrapper.get('button').element as HTMLElement
    await wrapper.get('button').trigger('click')
    await wrapper.get('[role="listbox"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
  })

  it('closes when the full-screen backdrop behind the menu is clicked', async () => {
    const wrapper = await mountSuspended(Dropdown, { props: { options: OPTIONS, modelValue: null } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)
    const backdrop = wrapper.findAll('div').find(d => d.classes().includes('fixed'))!
    await backdrop.trigger('click')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })
})
