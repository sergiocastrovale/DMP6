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

  it('searches MusicBrainz on the Search button', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/artists/mb-search') {return Promise.resolve({ items: [searchRow()] })}
      if (url.startsWith('/api/artists/mb-official-count/')) {return Promise.resolve({ count: 38 })}
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
    await mount()
    await wrapper!.find('input').setValue('radiohead')
    await wrapper!.findAll('button').find(b => b.text().includes('Search in MusicBrainz'))!.trigger('click')
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledWith('/api/artists/mb-search', { query: { q: 'radiohead' } })
    expect(wrapper!.text()).toContain('Radiohead')
    expect(wrapper!.text()).toContain('38')
  })

  it('loads official-release counts sequentially, one $fetch per row', async () => {
    const rows = [searchRow({ mbid: 'a', name: 'A' }), searchRow({ mbid: 'b', name: 'B' })]
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/artists/mb-search') {return Promise.resolve({ items: rows })}
      if (url === '/api/artists/mb-official-count/a') {return Promise.resolve({ count: 1 })}
      if (url === '/api/artists/mb-official-count/b') {return Promise.resolve({ count: 2 })}
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
    await mount()
    await wrapper!.find('input').setValue('x')
    await wrapper!.findAll('button').find(b => b.text().includes('Search in MusicBrainz'))!.trigger('click')
    await flushMicrotasks()

    expect(fetchMock).toHaveBeenCalledWith('/api/artists/mb-official-count/a')
    expect(fetchMock).toHaveBeenCalledWith('/api/artists/mb-official-count/b')
  })

  it('a fresh duplicate hit opens the error dialog and never runs the terminal', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/artists/mb-search') {return Promise.resolve({ items: [searchRow()] })}
      if (url.startsWith('/api/artists/mb-official-count/')) {return Promise.resolve({ count: 5 })}
      if (url === '/api/artists/by-mbid/mb-1') {return Promise.resolve({ slug: 'radiohead', name: 'Radiohead' })}
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
    await mount()
    await wrapper!.find('input').setValue('radiohead')
    await wrapper!.findAll('button').find(b => b.text().includes('Search in MusicBrainz'))!.trigger('click')
    await flushMicrotasks()

    await wrapper!.findAll('button').find(b => b.text().trim() === 'Add')!.trigger('click')
    await flushMicrotasks()

    expect(runMock).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('already in your library')
    expect(document.body.textContent).toContain('Go to artist')
  })

  it('adds an artist: runs ./add with --mbid, and --monitored only when checked', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/artists/mb-search') {return Promise.resolve({ items: [searchRow()] })}
      if (url.startsWith('/api/artists/mb-official-count/')) {return Promise.resolve({ count: 5 })}
      if (url === '/api/artists/by-mbid/mb-1') {return notFound()}
      if (url === '/api/artists/added/mb-1') {return Promise.resolve({ slug: 'radiohead' })}
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
    await mount()
    await wrapper!.find('input').setValue('radiohead')
    await wrapper!.findAll('button').find(b => b.text().includes('Search in MusicBrainz'))!.trigger('click')
    await flushMicrotasks()

    await wrapper!.findAll('button').find(b => b.text().trim() === 'Add')!.trigger('click')
    await flushMicrotasks()

    expect(runMock).toHaveBeenCalledWith('./add', ['--mbid', 'mb-1'], 'add-radiohead')
    expect(pushMock).toHaveBeenCalledWith('/artist/radiohead')
  })

  it('exit 0 navigates to the new artist page', async () => {
    terminal.exitCode = 0
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/artists/mb-search') {return Promise.resolve({ items: [searchRow()] })}
      if (url.startsWith('/api/artists/mb-official-count/')) {return Promise.resolve({ count: 5 })}
      if (url === '/api/artists/by-mbid/mb-1') {return notFound()}
      if (url === '/api/artists/added/mb-1') {return Promise.resolve({ slug: 'radiohead' })}
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
    await mount()
    await wrapper!.find('input').setValue('radiohead')
    await wrapper!.findAll('button').find(b => b.text().includes('Search in MusicBrainz'))!.trigger('click')
    await flushMicrotasks()
    await wrapper!.findAll('button').find(b => b.text().trim() === 'Add')!.trigger('click')
    await flushMicrotasks()

    expect(pushMock).toHaveBeenCalledWith('/artist/radiohead')
  })

  it('exit 3 shows the already-exists dialog instead of navigating', async () => {
    terminal.exitCode = 3
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/artists/mb-search') {return Promise.resolve({ items: [searchRow()] })}
      if (url.startsWith('/api/artists/mb-official-count/')) {return Promise.resolve({ count: 5 })}
      if (url === '/api/artists/by-mbid/mb-1') {return notFound()}
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
    await mount()
    await wrapper!.find('input').setValue('radiohead')
    await wrapper!.findAll('button').find(b => b.text().includes('Search in MusicBrainz'))!.trigger('click')
    await flushMicrotasks()
    await wrapper!.findAll('button').find(b => b.text().trim() === 'Add')!.trigger('click')
    await flushMicrotasks()

    expect(pushMock).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('already in your library')
  })

  it('another exit code shows a toast, no dialog and no navigation', async () => {
    terminal.exitCode = 1
    fetchMock.mockImplementation((url: string) => {
      if (url === '/api/artists/mb-search') {return Promise.resolve({ items: [searchRow()] })}
      if (url.startsWith('/api/artists/mb-official-count/')) {return Promise.resolve({ count: 5 })}
      if (url === '/api/artists/by-mbid/mb-1') {return notFound()}
      return Promise.reject(new Error(`unexpected fetch ${url}`))
    })
    await mount()
    await wrapper!.find('input').setValue('radiohead')
    await wrapper!.findAll('button').find(b => b.text().includes('Search in MusicBrainz'))!.trigger('click')
    await flushMicrotasks()
    await wrapper!.findAll('button').find(b => b.text().trim() === 'Add')!.trigger('click')
    await flushMicrotasks()

    expect(pushMock).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
  })
})

function flushMicrotasks() {
  return new Promise(resolve => setTimeout(resolve, 0))
}
