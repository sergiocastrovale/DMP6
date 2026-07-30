import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGlobalStore } from '../../stores/global'

// $fetch is a raw ofetch global (not a Nuxt auto-import), so it's stubbed directly rather than via
// mockNuxtImport (which only works for names present in .nuxt/imports.d.ts).
const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

describe('useGlobalStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
  })

  it('starts with zeroed default stats and loaded=false', () => {
    const store = useGlobalStore()
    expect(store.loaded).toBe(false)
    expect(store.stats.artists).toBe(0)
  })

  it('playtimeHours/playtimeMinutes derive from stats.playtime (seconds)', () => {
    const store = useGlobalStore()
    store.stats.playtime = 3661 // 1h 1m 1s
    expect(store.playtimeHours).toBe(1)
    expect(store.playtimeMinutes).toBe(1)
  })

  it('fetch loads stats from /api/app-stats and sets loaded=true', async () => {
    fetchMock.mockResolvedValue({ artists: 5, releases: 1, tracks: 1, genres: 1, playtime: 0, totalFileSize: 0, totalPlays: 0, playlists: 0, favorites: 0, issues: 0 })
    const store = useGlobalStore()
    await store.fetch()
    expect(store.stats.artists).toBe(5)
    expect(store.loaded).toBe(true)
  })

  it('fetch swallows errors without setting loaded=true', async () => {
    fetchMock.mockRejectedValue(new Error('network'))
    const store = useGlobalStore()
    await store.fetch()
    expect(store.loaded).toBe(false)
  })

  it('refresh delegates to fetch', async () => {
    fetchMock.mockResolvedValue({ artists: 9, releases: 0, tracks: 0, genres: 0, playtime: 0, totalFileSize: 0, totalPlays: 0, playlists: 0, favorites: 0, issues: 0 })
    const store = useGlobalStore()
    await store.refresh()
    expect(store.stats.artists).toBe(9)
  })
})
