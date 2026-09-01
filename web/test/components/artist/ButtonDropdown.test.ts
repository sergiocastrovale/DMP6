import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import ButtonDropdown from '../../../components/artist/ButtonDropdown.vue'

const makeOptions = () => [
  { label: 'Scan for new files', action: vi.fn() },
  { label: 'Rebuild everything', description: 'Delete and re-index', action: vi.fn() },
]

describe('artist/ButtonDropdown.vue', () => {
  it('renders exactly one trigger button plus one per option', async () => {
    const options = makeOptions()
    const wrapper = await mountSuspended(ButtonDropdown, { props: { label: 'Scan catalogue', options } })
    expect(wrapper.findAll('button')).toHaveLength(1)
    await wrapper.get('button').trigger('click')
    expect(wrapper.findAll('button')).toHaveLength(3)
  })

  it('runs the option action and closes the menu on click', async () => {
    const options = makeOptions()
    const wrapper = await mountSuspended(ButtonDropdown, { props: { label: 'Scan catalogue', options } })
    await wrapper.get('button').trigger('click')
    await wrapper.findAll('[role="menuitem"]')[0]!.trigger('click')
    expect(options[0]!.action).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const options = makeOptions()
    const wrapper = await mountSuspended(ButtonDropdown, { props: { label: 'Scan catalogue', options }, attachTo: document.body })
    const trigger = wrapper.get('button').element as HTMLElement
    await wrapper.get('button').trigger('click')
    await wrapper.get('[role="menu"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger)
    wrapper.unmount()
  })

  it('closes when the full-screen backdrop behind the menu is clicked', async () => {
    const options = makeOptions()
    const wrapper = await mountSuspended(ButtonDropdown, { props: { label: 'Scan catalogue', options } })
    await wrapper.get('button').trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(true)
    const backdrop = wrapper.findAll('div').find(d => d.classes().includes('fixed'))!
    await backdrop.trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })

  it('does not open when disabled', async () => {
    const options = makeOptions()
    const wrapper = await mountSuspended(ButtonDropdown, { props: { label: 'Scan catalogue', options, disabled: true } })
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
  })
})
