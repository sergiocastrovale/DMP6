import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ButtonForceUnlockScan from '../../../components/ui/ButtonForceUnlockScan.vue'

const fetchMock = vi.fn().mockResolvedValue(undefined)
mockNuxtImport('$fetch', () => fetchMock)

describe('ui/ButtonForceUnlockScan.vue', () => {
  afterEach(() => vi.clearAllMocks())

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
})
