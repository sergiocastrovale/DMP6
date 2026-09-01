import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RecentIssuesPanel from '../../../components/downloads/RecentIssuesPanel.vue'
import { useAuth } from '../../../composables/useAuth'

const EVENTS = {
  items: [
    { id: 'e1', level: 'error', message: 'Something broke', createdAt: new Date().toISOString() },
    { id: 'e2', level: 'warn', message: 'Something wobbled', createdAt: new Date().toISOString() },
  ],
  counts: { flagged: 2, archived: 0 },
}

// The Clear button is gated on downloads.crud. Set the real session rather than stubbing useAuth:
// the component resolves it through Nuxt's auto-import, which a globalThis stub never reaches - that
// mistake made the button permanently absent and the gating test pass for the wrong reason.
const setPerms = (permissions: string[]) => {
  useAuth().user.value = {
    id: 1,
    username: 'admin',
    email: 'admin@test.local',
    role: 'ADMIN',
    permissions,
    mustChangePassword: false,
  }
}

describe('downloads/RecentIssuesPanel.vue', () => {
  beforeEach(() => {
    setPerms(['downloads.crud'])
  })

  it('renders nothing when there are no events', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue({ items: [], counts: { flagged: 0, archived: 0 } }))
    const wrapper = await mountSuspended(RecentIssuesPanel)
    await flushPromises()
    expect(wrapper.find('div').exists()).toBe(false)
  })

  it('renders the toggle and refresh as sibling buttons, not nested', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(EVENTS))
    const wrapper = await mountSuspended(RecentIssuesPanel)
    await flushPromises()
    const ButtonRefresh = wrapper.get('[aria-label="Refresh issues"]')
    expect(ButtonRefresh.element.closest('button')).toBe(ButtonRefresh.element)
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

  it('shows when it last fetched, so a refresh that changes nothing still reads as having run', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(EVENTS))
    const wrapper = await mountSuspended(RecentIssuesPanel)
    await flushPromises()
    expect(wrapper.text()).toContain('updated')
  })

  it('links to the full Events tab', async () => {
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(EVENTS))
    const wrapper = await mountSuspended(RecentIssuesPanel)
    await flushPromises()
    expect(wrapper.get('[aria-label="View all events"]').attributes('href')).toBe('/downloads/events')
  })

  it('Clear archives exactly the events on show, then refetches', async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/archive')) { return Promise.resolve({ archived: 2 }) }
      return Promise.resolve(EVENTS)
    })
    vi.stubGlobal('$fetch', fetchMock)
    const wrapper = await mountSuspended(RecentIssuesPanel)
    await flushPromises()

    fetchMock.mockClear()
    await wrapper.get('[aria-label="Clear issues"]').trigger('click')
    await flushPromises()

    // The panel is capped at `limit`, so it must archive its own ids rather than "everything flagged".
    expect(fetchMock).toHaveBeenCalledWith('/api/downloads/monitor-events/archive', expect.objectContaining({
      method: 'POST',
      body: { ids: ['e1', 'e2'] },
    }))
    // ...and reload, so a cleared panel does not keep showing what it just dismissed.
    expect(fetchMock).toHaveBeenCalledWith('/api/downloads/monitor-events', expect.anything())
  })

  it('hides Clear without downloads.crud, since the request would 403', async () => {
    setPerms(['sync.view'])
    vi.stubGlobal('$fetch', vi.fn().mockResolvedValue(EVENTS))
    const wrapper = await mountSuspended(RecentIssuesPanel)
    await flushPromises()
    expect(wrapper.find('[aria-label="Clear issues"]').exists()).toBe(false)
    // Read-only controls stay.
    expect(wrapper.find('[aria-label="View all events"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="Refresh issues"]').exists()).toBe(true)
  })
})
