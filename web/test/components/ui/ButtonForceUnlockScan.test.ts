import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import ButtonForceUnlockScan from '../../../components/ui/ButtonForceUnlockScan.vue'

const fetchMock = vi.fn().mockResolvedValue(undefined)
vi.stubGlobal('$fetch', fetchMock)

const auth = vi.hoisted(() => ({ canUnlock: true }))
mockNuxtImport('useAuth', () => () => ({ hasPerm: (key: string) => ref(key === 'terminal.control' && auth.canUnlock) }))

describe('ui/ButtonForceUnlockScan.vue', () => {
  afterEach(() => {
    vi.clearAllMocks()
    auth.canUnlock = true
  })

  it('posts to the scan unlock endpoint and emits unlocked on click', async () => {
    const wrapper = await mountSuspended(ButtonForceUnlockScan)

    await wrapper.get('button').trigger('click')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(fetchMock).toHaveBeenCalledWith('/api/scan/unlock', { method: 'POST' })
    expect(wrapper.emitted('unlocked')).toBeTruthy()
  })

  it('does not emit unlocked when the request fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'))
    const wrapper = await mountSuspended(ButtonForceUnlockScan)

    await wrapper.get('button').trigger('click')
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(wrapper.emitted('unlocked')).toBeFalsy()
  })

  it('renders nothing without terminal.control - the endpoint is gated on it', async () => {
    auth.canUnlock = false
    const wrapper = await mountSuspended(ButtonForceUnlockScan)

    expect(wrapper.find('button').exists()).toBe(false)
  })
})
