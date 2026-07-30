import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMosaicStore } from '../../stores/mosaic'

const fetchMock = vi.fn()
vi.stubGlobal('$fetch', fetchMock)

const sseResponse = (chunks: string[]) => ({
  ok: true,
  body: {
    getReader: () => {
      let i = 0
      return {
        read: async () => {
          if (i >= chunks.length) return { done: true, value: undefined }
          const value = new TextEncoder().encode(chunks[i])
          i++
          return { done: false, value }
        },
      }
    },
  },
})

describe('useMosaicStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
    fetchMock.mockResolvedValue([])
  })

  it('loadMosaics fetches the list', async () => {
    fetchMock.mockResolvedValue([{ filename: 'a.jpg' }])
    const store = useMosaicStore()
    await store.loadMosaics()
    expect(store.mosaics).toEqual([{ filename: 'a.jpg' }])
  })

  it('generate updates progress from "progress" events and reloads mosaics on "result"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([
      'event: progress\ndata: {"current":1,"total":3}\n\n',
      'event: result\ndata: {"full":"f.jpg","preview":"p.jpg"}\n\n',
    ])))
    fetchMock.mockResolvedValue([{ filename: 'new.jpg' }])
    const store = useMosaicStore()
    await store.generate('chronological')
    expect(store.lastResult).toEqual({ full: 'f.jpg', preview: 'p.jpg' })
    expect(store.isGenerating).toBe(false)
    expect(store.mosaics).toEqual([{ filename: 'new.jpg' }])
  })

  it('generate is a no-op re-entrancy guard while already generating', async () => {
    const store = useMosaicStore()
    store.isGenerating = true
    vi.stubGlobal('fetch', vi.fn())
    await store.generate()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('deleteMosaic removes the item from the local list', async () => {
    const store = useMosaicStore()
    store.mosaics = [{ filename: 'a.jpg' } as any, { filename: 'b.jpg' } as any]
    fetchMock.mockResolvedValue({})
    await store.deleteMosaic('a.jpg')
    expect(store.mosaics.map(m => m.filename)).toEqual(['b.jpg'])
  })
})
