import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ScanActions from '../../../components/settings/ScanActions.vue'

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

describe('settings/ScanActions.vue (global)', () => {
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
