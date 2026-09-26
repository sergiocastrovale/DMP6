import type { Map as LeafletMap, GeoJSON as LeafletGeoJSON, Path, Layer, LeafletMouseEvent } from 'leaflet'
import type { Feature } from 'geojson'
import type { MapTextureEntry } from '~/types/labs'
import { cssVar } from '~/helpers/theme'
import { patternPlacement } from '~/helpers/mapTexture'

// The world map: a Leaflet map of country outlines (GeoJSON) whose fills can be replaced by cover-art patterns. Owns
// the Leaflet objects and their lifecycle; the page decides what a click does and which textures exist.
export const useLeafletMap = (
  container: Ref<HTMLElement | null>,
  options: { onCountryClick: (code: string) => void },
) => {
  const tooltip = ref<{ x: number, y: number, code: string } | null>(null)

  let map: LeafletMap | null = null
  let geoLayer: LeafletGeoJSON | null = null
  const layersByCode = new Map<string, Path>()
  const textures = new Map<string, MapTextureEntry>()

  const applyPatternFill = (layer: Path, code: string, tex: MapTextureEntry) => {
    if (!map || !geoLayer) {
      return
    }
    const renderer = map.getRenderer(layer) as unknown as { _container?: SVGSVGElement }
    const svg = renderer?._container
    const pathEl = layer.getElement() as SVGGraphicsElement | undefined
    if (!svg || !pathEl) {
      return
    }

    const bbox = pathEl.getBBox()
    if (bbox.width === 0 || bbox.height === 0) {
      return
    }
    const place = patternPlacement(bbox, tex)

    let defs = svg.querySelector('defs')
    if (!defs) {
      defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
      svg.insertBefore(defs, svg.firstChild)
    }

    const patId = `pat-${code}`
    let pattern = defs.querySelector(`#${patId}`) as SVGPatternElement | null
    if (!pattern) {
      pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern')
      pattern.setAttribute('id', patId)
      pattern.setAttribute('patternUnits', 'userSpaceOnUse')
      defs.appendChild(pattern)
    }
    pattern.setAttribute('x', String(bbox.x))
    pattern.setAttribute('y', String(bbox.y))
    pattern.setAttribute('width', String(bbox.width))
    pattern.setAttribute('height', String(bbox.height))
    pattern.innerHTML = `<image href="${tex.dataUrl}" x="${place.x}" y="${place.y}" width="${place.width}" height="${place.height}" />`

    const opts = layer.options as { fillColor?: string, fill?: boolean, fillOpacity?: number }
    opts.fillColor = `url(#${patId})`
    opts.fill = true
    opts.fillOpacity = 1

    pathEl.setAttribute('fill', `url(#${patId})`)
    pathEl.setAttribute('fill-opacity', '1')
  }

  // A country's cover mosaic is ready: remember it and paint it now if the map is up (or later, when it comes up).
  const setTexture = (code: string, tex: MapTextureEntry) => {
    textures.set(code, tex)
    const layer = layersByCode.get(code)
    if (layer) {
      applyPatternFill(layer, code, tex)
    }
  }

  // A zoom re-renders Leaflet's SVG paths, which drops the fills set on them directly.
  const applyAll = () => {
    for (const [code, tex] of textures) {
      const layer = layersByCode.get(code)
      if (layer) {
        applyPatternFill(layer, code, tex)
      }
    }
  }

  const ready = ref(false)

  onMounted(async () => {
    if (!container.value) {
      return
    }

    const L = await import('leaflet')
    await import('leaflet/dist/leaflet.css')
    const geojson = (await import('~/assets/world-geojson')).default

    map = L.map(container.value, {
      center: [20, 0],
      zoom: 2,
      minZoom: 2,
      maxZoom: 5,
      maxBounds: [[-85, -180], [85, 180]],
      maxBoundsViscosity: 1.0,
      zoomSnap: 1,
      zoomDelta: 1,
      attributionControl: false,
      preferCanvas: false,
    })

    geoLayer = L.geoJSON(geojson as Parameters<typeof L.geoJSON>[0], {
      style: () => ({
        color: cssVar('--color-stone-100'),
        weight: 0.8,
        fillColor: 'transparent',
        fillOpacity: 1,
        opacity: 1,
      }),
      onEachFeature: (feature: Feature, layer: Layer) => {
        const code = feature.properties?.ISO_A2
        if (code) {
          layersByCode.set(code, layer as Path)
        }

        layer.on('mouseover', (e: LeafletMouseEvent) => {
          tooltip.value = { x: e.originalEvent.clientX, y: e.originalEvent.clientY, code }
          ;(layer as Path).setStyle({ color: cssVar('--color-amber-400'), weight: 2 })
        })
        layer.on('mousemove', (e: LeafletMouseEvent) => {
          if (tooltip.value) {
            tooltip.value.x = e.originalEvent.clientX
            tooltip.value.y = e.originalEvent.clientY
          }
        })
        layer.on('mouseout', () => {
          tooltip.value = null
          ;(layer as Path).setStyle({ color: cssVar('--color-stone-100'), weight: 0.8 })
        })
        layer.on('click', () => options.onCountryClick(code))
      },
    }).addTo(map)

    map.on('zoomend', applyAll)
    ready.value = true
    applyAll()
  })

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      tooltip.value = null
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', onKeydown)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', onKeydown)
    map?.remove()
    map = null
    geoLayer = null
    layersByCode.clear()
    textures.clear()
  })

  return { tooltip, ready, setTexture }
}
