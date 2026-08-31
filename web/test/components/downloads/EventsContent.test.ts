import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import EventsContent from '../../../components/downloads/EventsContent.vue'
import SearchInput from '../../../components/SearchInput.vue'
import { useAuth } from '../../../composables/useAuth'

const FLAGGED = [
  { id: 'f1', level: 'error', message: 'transcode: rename failed Track.mp3', createdAt: new Date().toISOString(), archivedAt: null },
  { id: 'f2', level: 'warn', message: 'slskd: no source found', createdAt: new Date().toISOString(), archivedAt: null },
  { id: 'f3', level: 'warn', message: 'transcode: ffprobe missing', createdAt: new Date().toISOString(), archivedAt: null },
]
const ARCHIVED = [
  { id: 'a1', level: 'warn', message: 'old archived thing', createdAt: new Date().toISOString(), archivedAt: new Date().toISOString() },
]

const setPerms = (permissions: string[]) => {
  useAuth().user.value = {
    id: 1, username: 'admin', email: 'admin@test.local',
    role: 'ADMIN', permissions, mustChangePassword: false,
  }
}

// One mock serving the list endpoint (either subtab) plus the three mutations.
const makeFetch = () => vi.fn().mockImplementation((url: string, opts?: any) => {
  const u = String(url)
  if (u.endsWith('/archive')) { return Promise.resolve({ archived: opts?.body?.ids?.length ?? 0 }) }
  if (u.endsWith('/restore')) { return Promise.resolve({ restored: 1 }) }
  if (u.endsWith('/delete')) { return Promise.resolve({ deleted: 1 }) }
  const archived = opts?.query?.archived === 'true'
  return Promise.resolve({
    items: archived ? ARCHIVED : FLAGGED,
    counts: { flagged: FLAGGED.length, archived: ARCHIVED.length },
  })
})

const mountEvents = async () => {
  const fetchMock = makeFetch()
  vi.stubGlobal('$fetch', fetchMock)
  const wrapper = await mountSuspended(EventsContent)
  await flushPromises()
  return { wrapper, fetchMock }
}

const button = (wrapper: any, text: string) =>
  wrapper.findAll('button').find((b: any) => b.text().includes(text))

// SearchInput debounces by 300ms, so setValue() alone never reaches this component inside a
// flushPromises. Emitting the model update directly tests the filtering rather than the debounce
// (which SearchInput's own test already covers).
const search = async (wrapper: any, term: string) => {
  wrapper.findComponent(SearchInput).vm.$emit('update:modelValue', term)
  await flushPromises()
}

// Dialog teleports to body, so its copy is not inside the wrapper's own tree.
const bodyText = () => document.body.textContent ?? ''
const bodyButton = (text: string) =>
  [...document.body.querySelectorAll('button')].find(b => (b.textContent ?? '').trim() === text)

describe('downloads/EventsContent.vue', () => {
  beforeEach(() => {
    setPerms(['downloads.crud', 'sync.view'])
  })

  it('opens on Flagged and lists the flagged events', async () => {
    const { wrapper } = await mountEvents()
    expect(wrapper.text()).toContain('transcode: rename failed Track.mp3')
    expect(wrapper.findAll('tbody tr')).toHaveLength(3)
  })

  it('offers both subtabs with their totals', async () => {
    const { wrapper } = await mountEvents()
    const tabs = wrapper.findAll('[role="tab"]').map((t: any) => t.text())
    expect(tabs.some((t: string) => t.includes('Flagged') && t.includes('3'))).toBe(true)
    expect(tabs.some((t: string) => t.includes('Archived') && t.includes('1'))).toBe(true)
  })

  it('switching to Archived refetches with archived=true', async () => {
    const { wrapper, fetchMock } = await mountEvents()
    fetchMock.mockClear()
    const archivedTab = wrapper.findAll('[role="tab"]').find((t: any) => t.text().includes('Archived'))!
    await archivedTab.trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/api/downloads/monitor-events', expect.objectContaining({
      query: expect.objectContaining({ archived: 'true' }),
    }))
    expect(wrapper.text()).toContain('old archived thing')
  })

  it('the clear button counts only what the search leaves visible', async () => {
    const { wrapper } = await mountEvents()
    expect(button(wrapper, 'Clear')!.text()).toContain('3 shown')

    // Two of the three fixtures mention "transcode".
    await search(wrapper, 'transcode')
    expect(button(wrapper, 'Clear')!.text()).toContain('2 shown')
  })

  it('clearing archives exactly the filtered ids, not the whole flagged set', async () => {
    const { wrapper, fetchMock } = await mountEvents()
    await search(wrapper, 'transcode')

    fetchMock.mockClear()
    await button(wrapper, 'Clear')!.trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith('/api/downloads/monitor-events/archive', expect.objectContaining({
      body: { ids: ['f1', 'f3'] },
    }))
  })

  it('archiving asks for no confirmation - it is reversible', async () => {
    const { wrapper } = await mountEvents()
    await button(wrapper, 'Clear')!.trigger('click')
    await flushPromises()
    expect(bodyText()).not.toContain('cannot be undone')
  })

  it('deleting all archived confirms first, because it is not reversible', async () => {
    const { wrapper, fetchMock } = await mountEvents()
    const archivedTab = wrapper.findAll('[role="tab"]').find((t: any) => t.text().includes('Archived'))!
    await archivedTab.trigger('click')
    await flushPromises()

    fetchMock.mockClear()
    await button(wrapper, 'Delete all archived')!.trigger('click')
    await flushPromises()

    // Nothing sent yet - the dialog is in the way.
    expect(fetchMock).not.toHaveBeenCalledWith('/api/downloads/monitor-events/delete', expect.anything())
    expect(bodyText()).toContain('cannot be undone')

    bodyButton('Delete')!.click()
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/api/downloads/monitor-events/delete', expect.objectContaining({
      body: { allArchived: true },
    }))
  })

  it('restoring an archived row sends just that id', async () => {
    const { wrapper, fetchMock } = await mountEvents()
    const archivedTab = wrapper.findAll('[role="tab"]').find((t: any) => t.text().includes('Archived'))!
    await archivedTab.trigger('click')
    await flushPromises()

    fetchMock.mockClear()
    await wrapper.get('[aria-label="Move back to flagged"]').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledWith('/api/downloads/monitor-events/restore', expect.objectContaining({
      body: { ids: ['a1'] },
    }))
  })

  it('without downloads.crud the list is readable but nothing can be changed', async () => {
    setPerms(['sync.view'])
    const { wrapper } = await mountEvents()
    expect(wrapper.text()).toContain('transcode: rename failed Track.mp3')
    expect(button(wrapper, 'Clear')).toBeUndefined()
  })
})
