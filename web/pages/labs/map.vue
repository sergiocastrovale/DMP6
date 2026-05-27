<script setup lang="ts">
import type { Map as LeafletMap, GeoJSON as LeafletGeoJSON, Path, Layer } from 'leaflet'
import type { Feature } from 'geojson'
import type { MapCountry } from '~/server/api/labs/map/countries.get'

definePageMeta({ layout: false })

const { resolve: resolveImage, artistImage } = useImageUrl()
const { data: countryData, status } = useFetch<Record<string, MapCountry>>('/api/labs/map/countries')

const mapContainer = ref<HTMLElement | null>(null)
const generationProgress = ref({ current: 0, total: 0 })
const generating = ref(false)
const tooltip = ref<{ x: number; y: number; code: string } | null>(null)

let map: LeafletMap | null = null
let geoLayer: LeafletGeoJSON | null = null
const layersByCode = new Map<string, Path>()

const dialogOpen = ref(false)
const dialogCountry = ref<{ code: string; name: string; count: number } | null>(null)
const dialogArtists = ref<any[]>([])
const dialogPage = ref(1)
const dialogHasMore = ref(false)
const dialogLoading = ref(false)
const dialogScrollContainer = ref<HTMLElement | null>(null)

const coverageStat = computed(() => {
  if (!countryData.value) {
    return { countries: 0, artists: 0 }
  }
  const entries = Object.values(countryData.value)
  return {
    countries: entries.length,
    artists: entries.reduce((sum, c) => sum + c.count, 0),
  }
})

const progressPercent = computed(() => {
  if (generationProgress.value.total === 0) {
    return 0
  }
  return Math.round((generationProgress.value.current / generationProgress.value.total) * 100)
})

const tooltipData = computed(() => {
  if (!tooltip.value || !countryData.value) {
    return null
  }
  const entry = countryData.value[tooltip.value.code]
  return entry
    ? { name: entry.name, count: entry.count }
    : { name: tooltip.value.code, count: 0 }
})

const CELL_PX = 100

const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((res, rej) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = () => rej(new Error(`Failed: ${src}`))
    img.src = src
  })

interface TextureEntry { dataUrl: string; cols: number; rows: number }

const generateTexture = async (entry: MapCountry): Promise<TextureEntry | null> => {
  const urls: string[] = []
  for (const img of entry.images) {
    const url = resolveImage(img.image, img.imageUrl, 'releases')
    if (url) {
      urls.push(url)
    }
  }
  if (urls.length === 0) {
    return null
  }

  const cols = Math.ceil(Math.sqrt(urls.length))
  const rows = Math.ceil(urls.length / cols)

  const canvas = document.createElement('canvas')
  canvas.width = cols * CELL_PX
  canvas.height = rows * CELL_PX
  const ctx = canvas.getContext('2d')!

  const loaded = await Promise.allSettled(urls.map(loadImage))
  let idx = 0
  for (const result of loaded) {
    if (result.status === 'fulfilled') {
      const col = idx % cols
      const row = Math.floor(idx / cols)
      ctx.drawImage(result.value, col * CELL_PX, row * CELL_PX, CELL_PX, CELL_PX)
    }
    idx++
  }

  return { dataUrl: canvas.toDataURL('image/png'), cols, rows }
}

const textureData = ref<Record<string, TextureEntry>>({})

const applyPatternFill = (layer: Path, code: string, tex: TextureEntry) => {
  if (!map || !geoLayer) {
    return
  }
  const renderer = map.getRenderer(layer as any) as any
  const svg = renderer?._container as SVGSVGElement | undefined
  if (!svg) {
    return
  }

  const pathEl = layer.getElement() as SVGGraphicsElement | undefined
  if (!pathEl) {
    return
  }

  const bbox = pathEl.getBBox()
  if (bbox.width === 0 || bbox.height === 0) {
    return
  }

  const canvasAR = tex.cols / tex.rows
  const bboxAR = bbox.width / bbox.height
  let imgW: number, imgH: number
  if (canvasAR > bboxAR) {
    imgH = bbox.height
    imgW = imgH * canvasAR
  } else {
    imgW = bbox.width
    imgH = imgW / canvasAR
  }
  const imgX = (bbox.width - imgW) / 2
  const imgY = (bbox.height - imgH) / 2

  let defs = svg.querySelector('defs')
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    svg.insertBefore(defs, svg.firstChild)
  }

  const patId = `pat-${code}`
  let pattern = defs.querySelector(`#${patId}`) as SVGPatternElement | null
  if (!pattern) {
    pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern') as SVGPatternElement
    pattern.setAttribute('id', patId)
    pattern.setAttribute('patternUnits', 'userSpaceOnUse')
    defs.appendChild(pattern)
  }
  pattern.setAttribute('x', String(bbox.x))
  pattern.setAttribute('y', String(bbox.y))
  pattern.setAttribute('width', String(bbox.width))
  pattern.setAttribute('height', String(bbox.height))
  pattern.innerHTML = `<image href="${tex.dataUrl}" x="${imgX}" y="${imgY}" width="${imgW}" height="${imgH}" />`

  const opts = (layer as any).options
  opts.fillColor = `url(#${patId})`
  opts.fill = true
  opts.fillOpacity = 1

  pathEl.setAttribute('fill', `url(#${patId})`)
  pathEl.setAttribute('fill-opacity', '1')
}

const applyAllPatterns = () => {
  for (const [code, tex] of Object.entries(textureData.value)) {
    const layer = layersByCode.get(code)
    if (layer) {
      applyPatternFill(layer, code, tex)
    }
  }
}

const generateAllTextures = async () => {
  if (!countryData.value || generating.value) {
    return
  }

  generating.value = true
  const entries = Object.entries(countryData.value)
  generationProgress.value = { current: 0, total: entries.length }

  const BATCH_SIZE = 5
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(([, entry]) => generateTexture(entry)),
    )
    for (let j = 0; j < batch.length; j++) {
      const result = results[j]
      if (result && result.status === 'fulfilled' && result.value) {
        const code = batch[j]![0]
        textureData.value[code] = result.value
        const layer = layersByCode.get(code)
        if (layer) {
          applyPatternFill(layer, code, result.value)
        }
      }
    }
    generationProgress.value.current = Math.min(i + BATCH_SIZE, entries.length)
  }

  generating.value = false
}

const fetchArtists = async (code: string, page: number) => {
  dialogLoading.value = true
  try {
    const data = await $fetch<any>('/api/labs/map/artists', {
      query: { country: code, page, pageSize: 50 },
    })
    if (page === 1) {
      dialogArtists.value = data.items
    } else {
      dialogArtists.value.push(...data.items)
    }
    dialogHasMore.value = data.hasMore
    dialogPage.value = page
  } finally {
    dialogLoading.value = false
  }
}

const openCountryDialog = (code: string) => {
  const entry = countryData.value?.[code]
  if (!entry || entry.count === 0) {
    return
  }
  dialogCountry.value = { code, name: entry.name, count: entry.count }
  dialogArtists.value = []
  dialogPage.value = 1
  dialogHasMore.value = false
  dialogOpen.value = true
  fetchArtists(code, 1)
}

const loadMoreArtists = () => {
  if (!dialogLoading.value && dialogHasMore.value && dialogCountry.value) {
    fetchArtists(dialogCountry.value.code, dialogPage.value + 1)
  }
}

const onDialogScroll = (e: Event) => {
  const el = e.target as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
    loadMoreArtists()
  }
}

onMounted(async () => {
  if (!mapContainer.value) {
    return
  }

  const L = await import('leaflet')
  await import('leaflet/dist/leaflet.css')
  const geojson = (await import('~/assets/world-geojson')).default

  map = L.map(mapContainer.value, {
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

  const getStyle = (feature?: Feature) => {
    const code = feature?.properties?.ISO_A2
    return {
      color: 'white',
      weight: 0.8,
      fillColor: 'transparent',
      fillOpacity: 1,
      opacity: 1,
    }
  }

  geoLayer = L.geoJSON(geojson as any, {
    style: getStyle,
    onEachFeature: (feature: Feature, layer: Layer) => {
      const code = feature.properties?.ISO_A2
      if (code) {
        layersByCode.set(code, layer as Path)
      }

      layer.on('mouseover', (e: any) => {
        tooltip.value = { x: e.originalEvent.clientX, y: e.originalEvent.clientY, code }
        ;(layer as Path).setStyle({ color: 'oklch(0.82 0.25 92)', weight: 2 })
      })
      layer.on('mousemove', (e: any) => {
        if (tooltip.value) {
          tooltip.value.x = e.originalEvent.clientX
          tooltip.value.y = e.originalEvent.clientY
        }
      })
      layer.on('mouseout', () => {
        tooltip.value = null
        ;(layer as Path).setStyle({ color: 'white', weight: 0.8 })
      })
      layer.on('click', () => {
        openCountryDialog(code)
      })
    },
  }).addTo(map)

  map.on('zoomend', () => {
    applyAllPatterns()
  })

  if (countryData.value) {
    generateAllTextures()
  }
})

watch(countryData, (val) => {
  if (val && map) {
    generateAllTextures()
  }
})

onUnmounted(() => {
  map?.remove()
  map = null
  geoLayer = null
  layersByCode.clear()
})
</script>

<template>
  <div class="flex h-screen flex-col bg-bg font-sans text-ink antialiased">
    <LabsHeader />

    <div class="relative flex-1">
      <div ref="mapContainer" class="absolute inset-0" />

      <div
        v-if="status === 'pending'"
        class="pointer-events-none absolute inset-0 flex items-center justify-center"
      >
        <div class="text-sm text-ink-2">Loading map data...</div>
      </div>

      <div
        v-if="generating"
        class="pointer-events-none absolute left-4 right-4 top-4 z-[1000]"
      >
        <div class="mx-auto max-w-xs overflow-hidden rounded-full bg-bg-2/80 backdrop-blur">
          <div
            class="h-1.5 rounded-full bg-accent transition-all duration-300"
            :style="{ width: `${progressPercent}%` }"
          />
        </div>
        <div class="mt-1 text-center text-xs text-ink-2">
          {{ generationProgress.current }}/{{ generationProgress.total }}
        </div>
      </div>

      <div
        v-if="coverageStat.countries > 0"
        class="pointer-events-none absolute bottom-4 right-4 z-[1000] rounded-lg bg-bg-1/80 px-3 py-2 text-sm text-ink-2 backdrop-blur"
      >
        Showing <strong>{{ coverageStat.artists }}</strong> artists from <strong>{{ coverageStat.countries }}</strong> countries
      </div>
    </div>

    <PlayerAudioPlayer />

    <Teleport to="body">
      <div
        v-if="tooltip && tooltipData"
        class="pointer-events-none fixed z-[2000] rounded-lg border border-rule bg-bg-1 px-3 py-2 shadow-lg"
        :style="{
          left: `${tooltip.x + 12}px`,
          top: `${tooltip.y - 10}px`,
        }"
      >
        <div class="text-sm font-semibold text-ink">{{ tooltipData.name }}</div>
        <div v-if="tooltipData.count > 0" class="text-xs text-ink-2">
          {{ tooltipData.count }} {{ tooltipData.count === 1 ? 'artist' : 'artists' }}
        </div>
        <div v-else class="text-xs text-ink-3">No artists</div>
      </div>
    </Teleport>

    <Dialog
      v-model="dialogOpen"
      :title="dialogCountry ? `${dialogCountry.name} (${dialogCountry.count})` : ''"
      max-width="lg"
    >
      <div @scroll="onDialogScroll" class="-mx-6 -my-4 max-h-[70vh] overflow-y-auto px-6 py-4">
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          <Block
            v-for="artist in dialogArtists"
            :key="artist.id"
            :id="artist.id"
            :title="artist.name"
            :image="artistImage(artist)"
            :link="`/artist/${artist.slug}`"
          />
        </div>
        <div v-if="dialogLoading" class="py-6 text-center text-sm text-ink-2">
          Loading...
        </div>
        <div v-if="!dialogLoading && dialogArtists.length === 0" class="py-6 text-center text-sm text-ink-2">
          No artists found
        </div>
      </div>
    </Dialog>
  </div>
</template>

<style>
.leaflet-container {
  background: transparent !important;
}

.leaflet-control-zoom a {
  background-color: var(--color-bg-2, #1a1a2e) !important;
  color: var(--color-ink, #e0e0e0) !important;
  border-color: var(--color-rule, #333) !important;
}

.leaflet-control-zoom a:hover {
  background-color: var(--color-bg-1, #252540) !important;
}
</style>
