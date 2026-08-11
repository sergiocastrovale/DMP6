import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ScanActions from '../../components/ScanActions.vue'
import ArtistScanActions from '../../components/artist/ScanActions.vue'
import { scanActions } from '../../helpers/constants'

// Plain values, not refs: vi.hoisted runs before vue is imported.
const { runMock, auth } = vi.hoisted(() => ({
  runMock: vi.fn().mockResolvedValue(undefined),
  auth: { isAdmin: true },
}))

vi.mock('~/stores/terminal', () => ({
  useTerminalStore: () => ({ run: runMock, isRunning: false }),
}))

// Read at setup time, which is after each test has set the flag it wants.
mockNuxtImport('useAuth', () => () => ({ isAdmin: { value: auth.isAdmin } }))

// Every rendered action must resolve to a real handler. The global grid used to render the
// artist-only 'catalogue-gaps' entry it had no handler for, so clicking it threw.
const clickAll = async (buttons: { trigger: (e: string) => Promise<void> }[]) => {
  for (const button of buttons) {
    await button.trigger('click')
  }
}

describe('ScanActions.vue (global)', () => {
  beforeEach(() => {
    runMock.mockClear()
    auth.isAdmin = true
  })

  it('never renders artist-only actions', async () => {
    const wrapper = await mountSuspended(ScanActions)
    expect(wrapper.text()).not.toContain('Catalogue gaps')
    expect(wrapper.findAll('button')).toHaveLength(5)
  })

  it('hides the destructive full re-scan from non-admins', async () => {
    auth.isAdmin = false
    const wrapper = await mountSuspended(ScanActions)
    expect(wrapper.text()).not.toContain('Full re-scan')
    expect(wrapper.findAll('button')).toHaveLength(4)
  })

  it('re-reads changed files with --inspect, which needs no admin flag', async () => {
    auth.isAdmin = false
    const wrapper = await mountSuspended(ScanActions)
    const inspect = wrapper.findAll('button')[1]!
    expect(inspect.text()).toContain('Re-check changed files')
    await inspect.trigger('click')
    expect(runMock.mock.calls).toEqual([['./index', ['--inspect']]])
  })

  it('runs an unflagged index+sync for "Check for new files"', async () => {
    const wrapper = await mountSuspended(ScanActions)
    await wrapper.findAll('button')[0]!.trigger('click')
    expect(runMock.mock.calls).toEqual([['./index', []], ['./sync', []]])
  })

  it('runs a full re-read and rematch for "Full re-scan", without --prune library-wide', async () => {
    const wrapper = await mountSuspended(ScanActions)
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(runMock.mock.calls).toEqual([
      ['./index', ['--overwrite-with-images']],
      ['./sync', ['--overwrite']],
    ])
  })

  it('gives every rendered action a handler', async () => {
    const wrapper = await mountSuspended(ScanActions)
    await clickAll(wrapper.findAll('button'))
    expect(runMock).toHaveBeenCalled()
  })
})

describe('artist/ScanActions.vue', () => {
  const props = { artistName: 'Boards of Canada', folders: ['Boards of Canada'] }

  const openMenu = async () => {
    const wrapper = await mountSuspended(ArtistScanActions, { props })
    await wrapper.findAll('button')[0]!.trigger('click')
    return wrapper
  }

  beforeEach(() => {
    runMock.mockClear()
    auth.isAdmin = true
  })

  it('scopes the normal check to the artist folders and name, with no destructive flag', async () => {
    const wrapper = await openMenu()
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(runMock.mock.calls).toEqual([
      ['./index', ['--only', 'Boards of Canada', '--exact']],
      ['./sync', ['--only', 'Boards of Canada', '--exact']],
    ])
  })

  it('prunes and rematches on a full re-scan', async () => {
    const wrapper = await openMenu()
    await wrapper.findAll('button')[2]!.trigger('click')
    expect(runMock.mock.calls).toEqual([
      ['./index', ['--only', 'Boards of Canada', '--exact', '--overwrite-with-images', '--prune']],
      ['./sync', ['--only', 'Boards of Canada', '--exact', '--overwrite']],
    ])
  })

  it('scopes --inspect to the artist folders so replaced files are re-read', async () => {
    const wrapper = await openMenu()
    await wrapper.findAll('button')[3]!.trigger('click')
    expect(runMock.mock.calls).toEqual([
      ['./index', ['--only', 'Boards of Canada', '--exact', '--inspect']],
    ])
  })

  it('joins multiple scan roots with a semicolon', async () => {
    const wrapper = await mountSuspended(ArtistScanActions, {
      props: { artistName: 'Aphex Twin', folders: ['Aphex Twin', 'AFX'] },
    })
    await wrapper.findAll('button')[0]!.trigger('click')
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(runMock.mock.calls[0]).toEqual(['./index', ['--only', 'Aphex Twin;AFX', '--exact']])
  })

  it('keeps catalogue gaps, and hides only the full re-scan from non-admins', async () => {
    auth.isAdmin = false
    const wrapper = await openMenu()
    expect(wrapper.text()).toContain('Catalogue gaps')
    expect(wrapper.text()).not.toContain('Full re-scan')
    // One trigger button plus every action except the admin-only one.
    expect(wrapper.findAll('button')).toHaveLength(scanActions.length)
  })

  it('gives every rendered action a handler', async () => {
    // Selecting an option closes the menu, so each option needs its own mount.
    for (let i = 1; i <= scanActions.length; i++) {
      runMock.mockClear()
      const wrapper = await openMenu()
      await wrapper.findAll('button')[i]!.trigger('click')
      expect(runMock).toHaveBeenCalled()
    }
  })
})
