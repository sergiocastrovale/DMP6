import { cssVar } from '~/helpers/theme'
import { exportFilename, standaloneSvgMarkup } from '~/helpers/svgExport'

// Downloads the map as it is on screen. The map is one Leaflet SVG whose country fills are patterns backed by data:
// URIs, so a serialized copy needs no network at draw time and the rasterizing canvas stays untainted by cross-origin
// data - which is what would otherwise make toBlob() throw.
export const useMapExport = (container: Ref<HTMLElement | null>) => {
  const exporting = ref(false)

  const downloadPng = async () => {
    const svg = container.value?.querySelector('svg')
    if (!svg || exporting.value) {
      return
    }
    exporting.value = true
    let url: string | null = null
    try {
      const { width, height } = svg.getBoundingClientRect()
      const markup = standaloneSvgMarkup(
        new XMLSerializer().serializeToString(svg),
        Math.round(width),
        Math.round(height),
        cssVar('--color-stone-950'),
      )

      const image = new Image()
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('Could not rasterize the map'))
        image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`
      })

      const canvas = document.createElement('canvas')
      canvas.width = Math.round(width)
      canvas.height = Math.round(height)
      canvas.getContext('2d')!.drawImage(image, 0, 0)

      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
      if (!blob) {
        return
      }

      url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = exportFilename('dmp-world-map')
      link.click()
    }
    catch { /* nothing to download - leave the map as it was */ }
    finally {
      if (url) {
        URL.revokeObjectURL(url)
      }
      exporting.value = false
    }
  }

  return { exporting, downloadPng }
}
