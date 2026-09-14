import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ArtistAddSearch from '../../../../components/artist/add/Search.vue'

// Plain values, not refs: vi.hoisted runs before vue is imported.
const { runMock, terminal, toast, pushMock, fetchMock, auth } = vi.hoisted(() => ({
  runMock: vi.fn().mockResolvedValue(undefined),
  terminal: { exitCode: 0 },
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
  pushMock: vi.fn(),
  fetchMock: vi.fn(),
  auth: { canMonitor: true },
}))

vi.mock('~/stores/terminal', () => ({
  useTerminalStore: () => ({ run: runMock, get exitCode() { return terminal.exitCode } }),
}))

vi.mock('~/stores/toast', () => ({
  useToastStore: () => toast,
}))

// The component redirects through nuxtApp.runWithContext(() => navigateTo(...)) - see
// components/artist/DeleteDialog.vue for why pushMock has to come from vi.hoisted.
mockNuxtImport('navigateTo', () => pushMock)
mockNuxtImport('useAuth', () => () => ({ hasPerm: () => ({ value: auth.canMonitor }) }))

vi.stubGlobal('$fetch', fetchMock)

const searchRow = (overrides: Partial<{ mbid: string, name: string, existing: unknown }> = {}) => ({
  mbid: 'mb-1',
  name: 'Radiohead',
  disambiguation: null,
  country: 'GB',
  type: 'Group',
  existing: null,
  ...overrides,
})

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  wrapper = undefined
  document.body.innerHTML = ''
})

const mount = async () => {
  wrapper = await mountSuspended(ArtistAddSearch)
  return wrapper
}

const notFound = () => {
  const err: any = new Error('Not found')
  err.statusCode = 404
  return Promise.reject(err)
}

const doSearch = async (name = 'radiohead') => {
  await wrapper!.find('input').setValue(name)
  await wrapper!.findAll('button').find(b => b.text().includes('Search in MusicBrainz'))!.trigger('click')
  await flushMicrotasks()
}

const clickAdd = async () => {
  await wrapper!.findAll('button').find(b => b.text().trim() === 'Add')!.trigger('click')
  await flushMicrotasks()
}

describe('artist/add/Search.vue', () => {
  beforeEach(() => {
    runMock.mockClear()
    pushMock.mockClear()
    toast.success.mockClear()
    toast.error.mockClear()
    fetchMock.mockReset()
    terminal.exitCode = 0
    auth.canMonitor = true
  })

  it('does not search while typing - only on submit', async () => {
    await mount()
    await wrapper!.find('input').setValue('radio')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('searches MusicBrainz on the Search button, one call only', async () => {
    fetchMock.mockResolvedValue({ items: [searchRow()] })
    await mount()
    await doSearch()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('/api/artists/mb-search', { query: { q: 'radiohead' } })
    expect(wrapper!.text()).toContain('Radiohead')
  })

  it('an already-in-library row is greyed out with no Add button', async () => {
    fetchMock.mockResolvedValue({ items: [searchRow({ existing: { slug: 'radiohead', name: 'Radiohead' } })] })
    await mount()
    await doSearch()

    expect(wrapper!.findAll('button').find(b => b.text().trim() === 'Add')).toBeUndefined()
    expect(wrapper!.text()).toContain('In library')
  })

  it('a fresh duplicate hit (race) opens the error dialog and never runs the terminal', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/artists/mb-search') {return Promise.resolve({ items: [searchRow()] })}
      if (url === '/api/artists/by-mbid/mb-1') {return Promise.resolve({ slug: 'radiohead', name: 'Radiohead' })}
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
    await mount()
    await doSearch()
    await clickAdd()

    expect(runMock).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('already in your library')
    expect(document.body.textContent).toContain('Go to artist')
  })

  it('adds an artist: runs ./add with --mbid, and --monitored only when checked', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/artists/mb-search') {return Promise.resolve({ items: [searchRow()] })}
      if (url === '/api/artists/by-mbid/mb-1') {return notFound()}
      if (url === '/api/artists/added/mb-1') {return Promise.resolve({ slug: 'radiohead' })}
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
    await mount()
    await doSearch()
    await clickAdd()

    expect(runMock).toHaveBeenCalledWith('./add', ['--mbid', 'mb-1'], 'add-radiohead')
    expect(pushMock).toHaveBeenCalledWith('/artist/radiohead')
  })

  it('exit 3 shows the already-exists dialog instead of navigating', async () => {
    terminal.exitCode = 3
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/artists/mb-search') {return Promise.resolve({ items: [searchRow()] })}
      if (url === '/api/artists/by-mbid/mb-1') {return notFound()}
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
    await mount()
    await doSearch()
    await clickAdd()

    expect(pushMock).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('already in your library')
  })

  it('another exit code shows a toast, no dialog and no navigation', async () => {
    terminal.exitCode = 1
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/artists/mb-search') {return Promise.resolve({ items: [searchRow()] })}
      if (url === '/api/artists/by-mbid/mb-1') {return notFound()}
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
    await mount()
    await doSearch()
    await clickAdd()

    expect(pushMock).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
  })
})

function flushMicrotasks() {
  return new Promise(resolve => setTimeout(resolve, 0))
}
