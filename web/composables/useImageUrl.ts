export function useImageUrl() {
  const config = useRuntimeConfig()
  const imageStorage = config.public.imageStorage as string
  const useS3 = imageStorage === 's3' || imageStorage === 'both'

  function resolve(
    image: string | null | undefined,
    imageUrl: string | null | undefined,
    type: 'artists' | 'releases',
  ): string | null {
    if (useS3 && imageUrl) {
      return imageUrl
    }
    if (image) {
      return `/img/${type}/${image}`
    }
    return null
  }

  function artistImage(artist: { image?: string | null; imageUrl?: string | null }): string | null {
    return resolve(artist.image, artist.imageUrl, 'artists')
  }

  function releaseImage(release: { image?: string | null; imageUrl?: string | null }): string | null {
    return resolve(release.image, release.imageUrl, 'releases')
  }

  return { resolve, artistImage, releaseImage }
}
