import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useImageUrl } from '../../composables/useImageUrl'
import { useSettingsStore } from '../../stores/settings'

describe('useImageUrl', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('resolves a local image path when storage is "local"', () => {
    const { resolve } = useImageUrl()
    expect(resolve('cover.jpg', null, 'releases')).toBe('/img/releases/cover.jpg')
  })

  it('prefers the S3 imageUrl when storage is "s3" and imageUrl is present', () => {
    useSettingsStore().imageStorage = 's3'
    const { resolve } = useImageUrl()
    expect(resolve('cover.jpg', 'https://cdn.example.com/cover.jpg', 'releases')).toBe('https://cdn.example.com/cover.jpg')
  })

  it('falls back to the local path under S3 storage when imageUrl is absent', () => {
    useSettingsStore().imageStorage = 's3'
    const { resolve } = useImageUrl()
    expect(resolve('cover.jpg', null, 'releases')).toBe('/img/releases/cover.jpg')
  })

  it('storage "both" also prefers imageUrl when present', () => {
    useSettingsStore().imageStorage = 'both'
    const { resolve } = useImageUrl()
    expect(resolve('cover.jpg', 'https://cdn.example.com/x.jpg', 'artists')).toBe('https://cdn.example.com/x.jpg')
  })

  it('returns null when there is no image at all', () => {
    const { resolve } = useImageUrl()
    expect(resolve(null, null, 'releases')).toBeNull()
  })

  it('artistImage/releaseImage delegate to resolve with the right type', () => {
    const { artistImage, releaseImage } = useImageUrl()
    expect(artistImage({ image: 'a.jpg' })).toBe('/img/artists/a.jpg')
    expect(releaseImage({ image: 'r.jpg' })).toBe('/img/releases/r.jpg')
  })
})
