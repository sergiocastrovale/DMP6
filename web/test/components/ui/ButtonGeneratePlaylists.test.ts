import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ButtonGeneratePlaylists from '../../../components/playlist/ButtonGeneratePlaylists.vue'
import { useTerminalStore } from '../../../stores/terminal'

describe('ui/ButtonGeneratePlaylists.vue', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.restoreAllMocks())

  it('labels itself "Generate Playlists" by default', async () => {
    const wrapper = await mountSuspended(ButtonGeneratePlaylists)
    expect(wrapper.text()).toContain('Generate Playlists')
  })

  it('labels itself "Regenerate" when scoped to an existing playlist', async () => {
    const wrapper = await mountSuspended(ButtonGeneratePlaylists, { props: { regenerate: true } })
    expect(wrapper.text()).toContain('Regenerate')
  })

  it('runs ./playlists on click', async () => {
    const wrapper = await mountSuspended(ButtonGeneratePlaylists)
    const terminal = useTerminalStore()
    const runSpy = vi.spyOn(terminal, 'run').mockResolvedValue(undefined as any)

    await wrapper.get('button').trigger('click')

    expect(runSpy).toHaveBeenCalledWith('./playlists', [])
  })
})
