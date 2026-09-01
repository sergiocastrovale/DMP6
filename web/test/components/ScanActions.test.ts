import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ScanActions from '../../components/ScanActions.vue'
import ArtistScanActions from '../../components/artist/ScanActions.vue'
import { artistScanActions } from '../../helpers/constants'

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

// Every rendered action must resolve to a real handler - the two surfaces read from separate action
// lists, so a rename on one side must not leave the other rendering an entry it cannot run.
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

  it('renders every library-wide action for an admin', async () => {
    const wrapper = await mountSuspended(ScanActions)
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

  it('scopes the normal scan to the artist folders and name, with no destructive flag', async () => {
    const wrapper = await openMenu()
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(runMock.mock.calls).toEqual([
      ['./index', ['--only', 'Boards of Canada', '--exact'], 'check-boards-of-canada'],
      ['./sync', ['--only', 'Boards of Canada', '--exact'], 'check-boards-of-canada'],
    ])
  })

  // --y matters: ./delete prompts on stdin, and nothing answers it in a tmux-backed run.
  it('deletes, re-indexes and re-matches for a full rebuild', async () => {
    const wrapper = await openMenu()
    await wrapper.findAll('button')[2]!.trigger('click')
    expect(runMock.mock.calls).toEqual([
      ['./delete', ['Boards of Canada', '--y'], 'rebuild-boards-of-canada'],
      ['./index', ['--only', 'Boards of Canada', '--exact', '--overwrite'], 'rebuild-boards-of-canada'],
      ['./sync', ['--only', 'Boards of Canada', '--exact', '--overwrite'], 'rebuild-boards-of-canada'],
    ])
  })

  it('stops before MusicBrainz when rebuilding from files only', async () => {
    const wrapper = await openMenu()
    await wrapper.findAll('button')[3]!.trigger('click')
    expect(runMock.mock.calls).toEqual([
      ['./delete', ['Boards of Canada', '--y'], 'reindex-boards-of-canada'],
      ['./index', ['--only', 'Boards of Canada', '--exact', '--overwrite'], 'reindex-boards-of-canada'],
    ])
  })

  it('re-matches without touching local files', async () => {
    const wrapper = await openMenu()
    await wrapper.findAll('button')[4]!.trigger('click')
    expect(runMock.mock.calls).toEqual([
      ['./sync', ['--only', 'Boards of Canada', '--exact', '--overwrite'], 'resync-boards-of-canada'],
    ])
  })

  // Two different artists resynced at once must not collide on the terminal store's 409
  // hasUnfinishedRun guard - see scanSessionName in helpers/functions.ts.
  it('scopes the session name to the artist, so two rows resynced at once do not collide', async () => {
    const wrapper = await mountSuspended(ArtistScanActions, {
      props: { artistName: 'Aphex Twin', folders: ['Aphex Twin', 'AFX'] },
    })
    await wrapper.findAll('button')[0]!.trigger('click')
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(runMock.mock.calls[0]).toEqual(['./index', ['--only', 'Aphex Twin;AFX', '--exact'], 'check-aphex-twin'])
  })

  it('leaves a non-admin only the additive scan - every rebuild deletes the artist first', async () => {
    auth.isAdmin = false
    const wrapper = await openMenu()
    expect(wrapper.text()).toContain('Scan for new files')
    expect(wrapper.text()).not.toContain('Rebuild')
    expect(wrapper.text()).not.toContain('Re-match from scratch')
    // The trigger button plus the single visible action.
    expect(wrapper.findAll('button')).toHaveLength(2)
  })

  it('gives every rendered action a handler', async () => {
    // Selecting an option closes the menu, so each option needs its own mount.
    for (let i = 1; i <= artistScanActions.length; i++) {
      runMock.mockClear()
      const wrapper = await openMenu()
      await wrapper.findAll('button')[i]!.trigger('click')
      expect(runMock).toHaveBeenCalled()
    }
  })
})
