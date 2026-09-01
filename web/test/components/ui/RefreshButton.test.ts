import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RefreshButton from '../../../components/ui/RefreshButton.vue'
import { useTerminalStore } from '../../../stores/terminal'

describe('ui/RefreshButton.vue', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.restoreAllMocks())

  it('renders the default label with no scope', async () => {
    const wrapper = await mountSuspended(RefreshButton)
    expect(wrapper.text()).toContain('Re-index + Re-sync')
    expect(wrapper.text()).not.toContain('(')
  })

  it('shows a count badge when scoped to artists', async () => {
    const wrapper = await mountSuspended(RefreshButton, { props: { only: ['Air Supply', 'Airbourne'] } })
    expect(wrapper.text()).toContain('(2)')
  })

  it('scopes the session name to the artist so two rows resynced at once do not collide', async () => {
    const wrapper = await mountSuspended(RefreshButton, { props: { only: ['Air Supply'] } })
    const terminal = useTerminalStore()
    const runSpy = vi.spyOn(terminal, 'run').mockResolvedValue(undefined as any)

    await wrapper.get('button').trigger('click')

    expect(runSpy).toHaveBeenCalledWith('./refresh', ['--only', 'Air Supply', '--exact'], 'refresh-air-supply')
  })

  it('runs plain ./refresh with the bare "refresh" session when unscoped', async () => {
    const wrapper = await mountSuspended(RefreshButton)
    const terminal = useTerminalStore()
    const runSpy = vi.spyOn(terminal, 'run').mockResolvedValue(undefined as any)

    await wrapper.get('button').trigger('click')

    expect(runSpy).toHaveBeenCalledWith('./refresh', [], 'refresh')
  })

  it('runs index --folders then sync --only under one shared session when both are scoped', async () => {
    const wrapper = await mountSuspended(RefreshButton, {
      props: { only: ['Air Supply'], folders: ['Air Supply'] },
    })
    const terminal = useTerminalStore()
    const runSpy = vi.spyOn(terminal, 'run').mockResolvedValue(undefined as any)

    await wrapper.get('button').trigger('click')

    expect(runSpy).toHaveBeenNthCalledWith(1, './index', ['--folders', 'Air Supply'], 'refresh-air-supply')
    expect(runSpy).toHaveBeenNthCalledWith(2, './sync', ['--only', 'Air Supply', '--exact'], 'refresh-air-supply')
  })
})
