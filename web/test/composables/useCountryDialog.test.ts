import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useCountryDialog } from '../../composables/useCountryDialog'

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

const countries = ref({
  PT: { name: 'Portugal', count: 3, images: [] },
  ZZ: { name: 'Nowhere', count: 0, images: [] },
})

const artist = (id: string) => ({ id, name: id, slug: id, image: null, imageUrl: null })

describe('useCountryDialog', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('opens on a country with artists and loads the first page', async () => {
    fetchMock.mockResolvedValueOnce({ items: [artist('a'), artist('b')], hasMore: true })
    const dialog = useCountryDialog(countries)
    dialog.openCountry('PT')
    expect(dialog.open.value).toBe(true)
    expect(dialog.country.value).toEqual({ code: 'PT', name: 'Portugal', count: 3 })
    await vi.waitFor(() => expect(dialog.artists.value).toHaveLength(2))
    expect(fetchMock).toHaveBeenCalledWith('/api/labs/map/artists', { query: { country: 'PT', page: 1, pageSize: 50 } })
    expect(dialog.hasMore.value).toBe(true)
  })

  it('ignores an unknown country or one with no artists', () => {
    const dialog = useCountryDialog(countries)
    dialog.openCountry('ZZ')
    dialog.openCountry('XX')
    expect(dialog.open.value).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('loadMore appends the next page and stops when there is no more', async () => {
    fetchMock.mockResolvedValueOnce({ items: [artist('a')], hasMore: true })
    const dialog = useCountryDialog(countries)
    dialog.openCountry('PT')
    await vi.waitFor(() => expect(dialog.artists.value).toHaveLength(1))

    fetchMock.mockResolvedValueOnce({ items: [artist('b')], hasMore: false })
    dialog.loadMore()
    await vi.waitFor(() => expect(dialog.artists.value.map(a => a.id)).toEqual(['a', 'b']))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/labs/map/artists', { query: { country: 'PT', page: 2, pageSize: 50 } })

    dialog.loadMore()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not start a second load while one is running', async () => {
    let release: (v: unknown) => void = () => {}
    fetchMock.mockReturnValueOnce(new Promise((r) => { release = r }))
    const dialog = useCountryDialog(countries)
    dialog.openCountry('PT')
    dialog.hasMore.value = true
    dialog.loadMore()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    release({ items: [], hasMore: false })
    await vi.waitFor(() => expect(dialog.loading.value).toBe(false))
  })
})
