import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlayerActions } from '../../composables/usePlayerActions'

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

describe('usePlayerActions.loadPlaylists', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
  })

  it('asks the server for manual playlists only and keeps what it returns', async () => {
    fetchMock.mockResolvedValueOnce([{ slug: 'mine', type: 'MANUAL' }])
    const actions = usePlayerActions()
    await actions.loadPlaylists()
    expect(fetchMock).toHaveBeenCalledWith('/api/playlists', { query: { type: 'manual' } })
    expect(actions.playlists.value.map((p: { slug: string }) => p.slug)).toEqual(['mine'])
  })
})
