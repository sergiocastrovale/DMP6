import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ButtonStop from '../../../components/ui/ButtonStop.vue'
import { useTerminalStore } from '../../../stores/terminal'

describe('ui/ButtonStop.vue', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => vi.restoreAllMocks())

  it('renders a labeled button by default', async () => {
    const wrapper = await mountSuspended(ButtonStop)
    expect(wrapper.text()).toContain('Stop')
  })

  it('renders icon-only with no label', async () => {
    const wrapper = await mountSuspended(ButtonStop, { props: { iconOnly: true } })
    expect(wrapper.text()).not.toContain('Stop')
  })

  it('stops the terminal session on click', async () => {
    const wrapper = await mountSuspended(ButtonStop)
    const terminal = useTerminalStore()
    const stopSpy = vi.spyOn(terminal, 'stop').mockResolvedValue(undefined as any)

    await wrapper.get('button').trigger('click')

    expect(stopSpy).toHaveBeenCalled()
  })
})
