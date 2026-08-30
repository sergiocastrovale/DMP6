import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import RecentIssuesPanel from '../../components/RecentIssuesPanel.vue'

const EVENTS = {
  items: [
    { id: 'e1', level: 'error', message: 'Something broke', createdAt: new Date().toISOString() },
  ],
}

describe('RecentIssuesPanel.vue', () => {
  it('renders nothing when there are no events', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ items: [] }))
    const wrapper = await mountSuspended(RecentIssuesPanel)
    await flushPromises()
    expect(wrapper.find('div').exists()).toBe(false)
  })

  it('renders the toggle and refresh as sibling buttons, not nested', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(EVENTS))
    const wrapper = await mountSuspended(RecentIssuesPanel)
    await flushPromises()
    const refreshButton = wrapper.get('[aria-label="Refresh issues"]')
    expect(refreshButton.element.closest('button')).toBe(refreshButton.element)
  })

  it('toggling open shows the event list independently of refreshing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(EVENTS)
    vi.stubGlobal('$fetch', fetchMock)
    const wrapper = await mountSuspended(RecentIssuesPanel)
    await flushPromises()

    expect(wrapper.find('li').exists()).toBe(false)
    await wrapper.get('[aria-expanded]').trigger('click')
    expect(wrapper.find('li').exists()).toBe(true)
    expect(wrapper.text()).toContain('Something broke')

    fetchMock.mockClear()
    await wrapper.get('[aria-label="Refresh issues"]').trigger('click')
    expect(fetchMock).toHaveBeenCalledOnce()
    // Refreshing must not have collapsed the list.
    expect(wrapper.find('li').exists()).toBe(true)
  })
})
