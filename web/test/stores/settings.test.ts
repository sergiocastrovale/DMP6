import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSettingsStore } from '../../stores/settings'

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

describe('useSettingsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
  })

  it('defaults to local storage with terminal hidden', () => {
    const store = useSettingsStore()
    expect(store.imageStorage).toBe('local')
    expect(store.showTerminal).toBe(false)
  })

  it('load populates fields from /api/settings/public', async () => {
    fetchMock.mockResolvedValue({ imageStorage: 's3', storagePublicUrl: 'https://cdn', showTerminal: true })
    const store = useSettingsStore()
    await store.load()
    expect(store.imageStorage).toBe('s3')
    expect(store.storagePublicUrl).toBe('https://cdn')
    expect(store.showTerminal).toBe(true)
  })
})
