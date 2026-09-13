import { mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ButtonRefresh from '../../../components/ui/ButtonRefresh.vue'

// Real store + `vi.spyOn(terminal, 'run')` does not work here: `runSequence` calls `run` as a plain
// closure inside the same setup-store function body, not through the store's public proxy, so an
// external spy on the returned object's `run` never sees those internal calls (this is why the
// never-renamed, never-run `ButtonRefresh.ts` predecessor of this file carried a test that always
// silently reported 0 calls). Mocking the module, as the other ScanActions specs do, sidesteps that
// entirely: the component only ever calls `run`/`runSequence` through the composable it imports.
const { runMock, isRunning } = vi.hoisted(() => ({
  runMock: vi.fn().mockResolvedValue(undefined),
  isRunning: { value: false },
}))

vi.mock('~/stores/terminal', () => ({
  useTerminalStore: () => ({
    run: runMock,
    runSequence: async (steps: Array<{ command: string, args: string[], session?: string }>) => {
      for (const s of steps) {
        await runMock(s.command, s.args, s.session)
      }
    },
    isRunning: isRunning.value,
  }),
}))

describe('ui/ButtonRefresh.vue', () => {
  beforeEach(() => {
    runMock.mockClear()
  })

  it('renders the default label with no scope', async () => {
    const wrapper = await mountSuspended(ButtonRefresh)
    expect(wrapper.text()).toContain('Re-index + Re-sync')
    expect(wrapper.text()).not.toContain('(')
  })

  it('shows a count badge when scoped to artists', async () => {
    const wrapper = await mountSuspended(ButtonRefresh, { props: { only: ['Air Supply', 'Airbourne'] } })
    expect(wrapper.text()).toContain('(2)')
  })

  it('scopes the session name to the artist so two rows resynced at once do not collide', async () => {
    const wrapper = await mountSuspended(ButtonRefresh, { props: { only: ['Air Supply'] } })

    await wrapper.get('button').trigger('click')

    expect(runMock).toHaveBeenCalledWith('./refresh', ['--only', 'Air Supply', '--exact'], 'refresh-air-supply')
  })

  it('runs plain ./refresh with the bare "refresh" session when unscoped', async () => {
    const wrapper = await mountSuspended(ButtonRefresh)

    await wrapper.get('button').trigger('click')

    expect(runMock).toHaveBeenCalledWith('./refresh', [], 'refresh')
  })

  it('runs index --folders, sync --only, then tidy under one shared session when both are scoped', async () => {
    const wrapper = await mountSuspended(ButtonRefresh, {
      props: { only: ['Air Supply'], folders: ['Air Supply'] },
    })

    await wrapper.get('button').trigger('click')

    expect(runMock.mock.calls).toEqual([
      ['./index', ['--folders', 'Air Supply'], 'refresh-air-supply'],
      ['./sync', ['--only', 'Air Supply', '--exact'], 'refresh-air-supply'],
      ['./tidy', [], 'refresh-air-supply'],
    ])
  })
})
