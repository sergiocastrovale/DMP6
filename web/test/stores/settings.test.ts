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

  it('defaults to local storage', () => {
    const store = useSettingsStore()
    expect(store.imageStorage).toBe('local')
  })

  it('load populates fields from /api/settings/public', async () => {
    fetchMock.mockResolvedValue({ imageStorage: 's3', storagePublicUrl: 'https://cdn' })
    const store = useSettingsStore()
    await store.load()
    expect(store.imageStorage).toBe('s3')
    expect(store.storagePublicUrl).toBe('https://cdn')
  })
})
