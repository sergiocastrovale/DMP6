import type { MapCountry, MapTextureEntry } from '~/types/labs'
import { TEXTURE_BATCH_SIZE, TEXTURE_CELL_PX, textureGrid } from '~/helpers/mapTexture'

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`Failed: ${src}`))
    img.src = src
  })

// Draws each country's covers onto a canvas (a near-square grid) and hands the result to `onTexture`, a few countries
// at a time, reporting progress. Runs once the map is ready and the country data is in.
export const useMapTextures = (
  countries: Ref<Record<string, MapCountry> | null | undefined>,
  ready: Ref<boolean>,
  onTexture: (code: string, texture: MapTextureEntry) => void,
) => {
  const { resolve: resolveImage } = useImageUrl()

  const generating = ref(false)
  const progress = ref({ current: 0, total: 0 })

  const progressPercent = computed(() =>
    progress.value.total === 0 ? 0 : Math.round((progress.value.current / progress.value.total) * 100),
  )

  const generateTexture = async (entry: MapCountry): Promise<MapTextureEntry | null> => {
    const urls = entry.images
      .map(img => resolveImage(img.image, img.imageUrl, 'releases'))
      .filter((url): url is string => !!url)
    if (urls.length === 0) {
      return null
    }

    const { cols, rows } = textureGrid(urls.length)
    const canvas = document.createElement('canvas')
    canvas.width = cols * TEXTURE_CELL_PX
    canvas.height = rows * TEXTURE_CELL_PX
    const ctx = canvas.getContext('2d')!

    const loaded = await Promise.allSettled(urls.map(loadImage))
    loaded.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        ctx.drawImage(result.value, (idx % cols) * TEXTURE_CELL_PX, Math.floor(idx / cols) * TEXTURE_CELL_PX, TEXTURE_CELL_PX, TEXTURE_CELL_PX)
      }
    })

    return { dataUrl: canvas.toDataURL('image/png'), cols, rows }
  }

  const generateAll = async () => {
    if (!countries.value || generating.value) {
      return
    }

    generating.value = true
    const entries = Object.entries(countries.value)
    progress.value = { current: 0, total: entries.length }

    for (let i = 0; i < entries.length; i += TEXTURE_BATCH_SIZE) {
      const batch = entries.slice(i, i + TEXTURE_BATCH_SIZE)
      const results = await Promise.allSettled(batch.map(([, entry]) => generateTexture(entry)))
      results.forEach((result, j) => {
        if (result.status === 'fulfilled' && result.value) {
          onTexture(batch[j]![0], result.value)
        }
      })
      progress.value.current = Math.min(i + TEXTURE_BATCH_SIZE, entries.length)
    }

    generating.value = false
  }

  // Whichever of "map ready" and "data loaded" comes second starts the run.
  watch([countries, ready], ([data, isReady]) => {
    if (data && isReady) {
      generateAll()
    }
  }, { immediate: true })

  return { generating, progress, progressPercent }
}
