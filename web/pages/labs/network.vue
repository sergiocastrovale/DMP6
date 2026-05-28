<script setup lang="ts">
import { Loader2, Network, Search, X } from 'lucide-vue-next'
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceCenter,
  forceCollide,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force'
import { scaleLinear, scaleSqrt } from 'd3-scale'
import { select } from 'd3-selection'
import { drag as d3Drag } from 'd3-drag'
import { zoom as d3Zoom, zoomIdentity } from 'd3-zoom'
import type { NetworkGraph } from '~/types/labs'

definePageMeta({ layout: 'labs' })

interface GraphNode extends SimulationNodeDatum {
  id: string
  name: string
  slug: string
  trackCount: number
  isMain: boolean
  isFocus: boolean
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  sharedTracks: number
  tracks: { id: string; title: string }[]
}

const searchQuery = ref('')
const searchResults = ref<{ id: string; name: string; slug: string }[]>([])
const searchOpen = ref(false)
const blurSearch = () => setTimeout(() => { searchOpen.value = false }, 200)
const selectedArtist = ref<{ id: string; name: string } | null>(null)
const loading = ref(true)
const graphData = ref<NetworkGraph | null>(null)
const minShared = ref(2)

const svgContainer = ref<HTMLElement | null>(null)
const tooltip = ref<{ x: number; y: number; name: string; tracks: number; isMain: boolean } | null>(null)
const linkTooltip = ref<{ x: number; y: number; source: string; target: string; shared: number; tracks: string[] } | null>(null)

let simulation: ReturnType<typeof forceSimulation<GraphNode>> | null = null
let searchDebounce: ReturnType<typeof setTimeout> | null = null

const doSearch = async (q: string) => {
  if (q.length < 2) {
    searchResults.value = []
    return
  }
  const data = await $fetch<any>('/api/search', { query: { q, limit: 10 } })
  searchResults.value = (data.artists || []).map((a: any) => ({
    id: a.id,
    name: a.name,
    slug: a.slug,
  }))
}

watch(searchQuery, (val) => {
  if (searchDebounce) {
    clearTimeout(searchDebounce)
  }
  if (val.length < 2) {
    searchResults.value = []
    return
  }
  searchDebounce = setTimeout(() => doSearch(val), 250)
})

const selectArtist = async (artist: { id: string; name: string }) => {
  selectedArtist.value = artist
  searchQuery.value = artist.name
  searchOpen.value = false
  searchResults.value = []
  await loadGraph(artist.id)
}

const clearSearch = async () => {
  selectedArtist.value = null
  searchQuery.value = ''
  searchResults.value = []
  await loadGraph()
}

const loadGraph = async (artistId?: string) => {
  loading.value = true
  try {
    const query: Record<string, any> = {}
    if (artistId) {
      query.artistId = artistId
    } else {
      query.minShared = minShared.value
    }
    graphData.value = await $fetch<NetworkGraph>('/api/labs/network/graph', { query })
    nextTick(renderGraph)
  } finally {
    loading.value = false
  }
}

const renderGraph = () => {
  if (!svgContainer.value || !graphData.value || graphData.value.nodes.length === 0) {
    return
  }

  simulation?.stop()
  const container = svgContainer.value
  container.innerHTML = ''

  const width = container.clientWidth
  const height = container.clientHeight

  const svg = select(container)
    .append('svg')
    .attr('width', width)
    .attr('height', height)

  const g = svg.append('g')

  const zoomBehavior = d3Zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.2, 5])
    .on('zoom', (event) => {
      g.attr('transform', event.transform)
    })

  svg.call(zoomBehavior as any)
  svg.call(zoomBehavior.transform as any, zoomIdentity.translate(width / 2, height / 2).scale(0.8))

  const nodes: GraphNode[] = graphData.value.nodes.map((n) => ({ ...n }))
  const links: GraphLink[] = graphData.value.links.map((l) => ({
    source: l.source,
    target: l.target,
    sharedTracks: l.sharedTracks,
    tracks: l.tracks,
  }))

  const maxShared = Math.max(...links.map((l) => l.sharedTracks), 1)
  const maxTracks = Math.max(...nodes.map((n) => n.trackCount), 1)

  const linkWidthScale = scaleLinear().domain([1, maxShared]).range([0.8, 6])
  const linkOpacityScale = scaleLinear().domain([1, maxShared]).range([0.2, 0.8])
  const nodeRadiusScale = scaleSqrt().domain([1, maxTracks]).range([5, 24])

  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  const linkElements = g
    .append('g')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('stroke', 'oklch(0.7 0.12 180)')
    .attr('stroke-width', (d: GraphLink) => linkWidthScale(d.sharedTracks))
    .attr('stroke-opacity', (d: GraphLink) => linkOpacityScale(d.sharedTracks))
    .attr('cursor', 'pointer')
    .on('mouseover', (event: MouseEvent, d: any) => {
      const src = typeof d.source === 'object' ? d.source : nodeMap.get(d.source)
      const tgt = typeof d.target === 'object' ? d.target : nodeMap.get(d.target)
      linkTooltip.value = {
        x: event.clientX,
        y: event.clientY,
        source: src?.name || '',
        target: tgt?.name || '',
        shared: d.sharedTracks,
        tracks: (d.tracks || []).map((t: any) => t.title),
      }
    })
    .on('mousemove', (event: MouseEvent) => {
      if (linkTooltip.value) {
        linkTooltip.value.x = event.clientX
        linkTooltip.value.y = event.clientY
      }
    })
    .on('mouseout', () => {
      linkTooltip.value = null
    })

  const nodeElements = g
    .append('g')
    .selectAll('circle')
    .data(nodes)
    .join('circle')
    .attr('r', (d: GraphNode) => d.isFocus ? nodeRadiusScale(d.trackCount) * 1.4 : nodeRadiusScale(d.trackCount))
    .attr('fill', (d: GraphNode) => {
      if (d.isFocus) { return 'oklch(0.82 0.25 92)' }
      return d.isMain ? 'oklch(0.75 0.18 250)' : 'oklch(0.7 0.15 330)'
    })
    .attr('stroke', (d: GraphNode) => {
      if (d.isFocus) { return 'oklch(0.9 0.2 92)' }
      return d.isMain ? 'oklch(0.85 0.18 250)' : 'oklch(0.8 0.15 330)'
    })
    .attr('stroke-width', (d: GraphNode) => d.isFocus ? 3 : 1.5)
    .attr('cursor', 'pointer')
    .on('mouseover', (event: MouseEvent, d: GraphNode) => {
      tooltip.value = { x: event.clientX, y: event.clientY, name: d.name, tracks: d.trackCount, isMain: d.isMain }
      if (!d.isFocus) {
        select(event.currentTarget as Element).attr('fill', 'oklch(0.82 0.25 92)')
      }
    })
    .on('mousemove', (event: MouseEvent) => {
      if (tooltip.value) {
        tooltip.value.x = event.clientX
        tooltip.value.y = event.clientY
      }
    })
    .on('mouseout', (event: MouseEvent, d: GraphNode) => {
      tooltip.value = null
      if (!d.isFocus) {
        const fill = d.isMain ? 'oklch(0.75 0.18 250)' : 'oklch(0.7 0.15 330)'
        select(event.currentTarget as Element).attr('fill', fill)
      }
    })
    .on('click', (_: MouseEvent, d: GraphNode) => {
      if (d.isFocus) {
        navigateTo(`/artist/${d.slug}`)
      } else {
        selectArtist({ id: d.id, name: d.name })
      }
    })

  const labelElements = g
    .append('g')
    .selectAll('text')
    .data(nodes)
    .join('text')
    .text((d: GraphNode) => d.name)
    .attr('font-size', (d: GraphNode) => d.isFocus ? 12 : Math.max(7, Math.min(10, nodeRadiusScale(d.trackCount) * 0.7)))
    .attr('font-weight', (d: GraphNode) => d.isFocus ? 'bold' : 'normal')
    .attr('fill', 'oklch(0.85 0 0)')
    .attr('text-anchor', 'middle')
    .attr('dy', (d: GraphNode) => {
      const r = d.isFocus ? nodeRadiusScale(d.trackCount) * 1.4 : nodeRadiusScale(d.trackCount)
      return r + 12
    })
    .attr('pointer-events', 'none')

  const dragBehavior = d3Drag<SVGCircleElement, GraphNode>()
    .on('start', (event, d) => {
      if (!event.active) {
        simulation?.alphaTarget(0.3).restart()
      }
      d.fx = d.x
      d.fy = d.y
    })
    .on('drag', (event, d) => {
      d.fx = event.x
      d.fy = event.y
    })
    .on('end', (event, d) => {
      if (!event.active) {
        simulation?.alphaTarget(0)
      }
      d.fx = null
      d.fy = null
    })

  nodeElements.call(dragBehavior as any)

  const hasFocus = nodes.some((n) => n.isFocus)
  const focusNode = nodes.find((n) => n.isFocus)
  if (focusNode) {
    focusNode.fx = 0
    focusNode.fy = 0
  }

  simulation = forceSimulation<GraphNode>(nodes)
    .force(
      'link',
      forceLink<GraphNode, GraphLink>(links)
        .id((d) => d.id)
        .distance((d) => hasFocus ? 140 / Math.sqrt(d.sharedTracks) : 100 / Math.sqrt(d.sharedTracks))
        .strength((d) => Math.min(0.8, d.sharedTracks / maxShared)),
    )
    .force('charge', forceManyBody().strength(hasFocus ? -250 : -150))
    .force('center', forceCenter(0, 0).strength(hasFocus ? 0.02 : 0.05))
    .force('collide', forceCollide<GraphNode>().radius((d) => nodeRadiusScale(d.trackCount) + 10))
    .on('tick', () => {
      linkElements
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y)

      nodeElements.attr('cx', (d: GraphNode) => d.x!).attr('cy', (d: GraphNode) => d.y!)
      labelElements.attr('x', (d: GraphNode) => d.x!).attr('y', (d: GraphNode) => d.y!)
    })

  if (focusNode) {
    setTimeout(() => {
      focusNode.fx = null
      focusNode.fy = null
    }, 2000)
  }
}

watch(minShared, () => {
  if (!selectedArtist.value) {
    loadGraph()
  }
})

onMounted(() => {
  loadGraph()
})

onUnmounted(() => {
  simulation?.stop()
  simulation = null
})
</script>

<template>
  <div class="grid h-full gap-6 lg:grid-cols-5">
    <div class="flex flex-col gap-6 lg:col-span-1">
      <div class="rounded-lg border border-rule bg-bg-1 p-5">
        <div class="mb-4 flex items-center gap-3">
          <div class="flex size-10 items-center justify-center rounded-lg bg-accent/10">
            <Network :size="20" class="text-accent" />
          </div>
          <div>
            <h2 class="text-sm font-semibold text-ink">Artist Network</h2>
            <p class="text-xs text-ink-2">Collaboration connections</p>
          </div>
        </div>

        <p class="mb-4 text-sm leading-relaxed text-ink-2">
          Artists connected by shared tracks. Search to focus on one artist's collaborations. Click any node to explore its network.
        </p>

        <div class="relative">
          <div class="flex items-center gap-2 rounded-md border border-rule bg-bg-2 px-3 py-2">
            <Search :size="14" class="shrink-0 text-ink-2" />
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Search artist..."
              class="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-2"
              @focus="searchOpen = true"
              @blur="blurSearch"
            />
            <button
              v-if="selectedArtist"
              class="shrink-0 text-ink-2 transition-colors hover:text-ink"
              @click="clearSearch"
            >
              <X :size="14" />
            </button>
          </div>

          <div
            v-if="searchOpen && searchResults.length > 0"
            class="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-rule bg-bg-1 shadow-lg"
          >
            <button
              v-for="result in searchResults"
              :key="result.id"
              class="w-full px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-bg-2"
              @mousedown.prevent="selectArtist(result)"
            >
              {{ result.name }}
            </button>
          </div>
        </div>

        <div v-if="!selectedArtist" class="mt-4">
          <label class="mb-1 block text-xs font-medium text-ink-2">
            Min shared tracks: {{ minShared }}
          </label>
          <input
            v-model.number="minShared"
            type="range"
            :min="1"
            :max="20"
            class="w-full accent-accent"
          />
        </div>

        <div v-if="graphData && graphData.nodes.length > 0" class="mt-4 text-xs text-ink-2">
          {{ graphData.nodes.length }} artists · {{ graphData.links.length }} connections
        </div>

        <div class="mt-4 flex flex-col gap-1.5 text-xs text-ink-2">
          <div v-if="selectedArtist" class="flex items-center gap-1.5">
            <div class="size-2.5 rounded-full" style="background: oklch(0.82 0.25 92)" />
            Selected
          </div>
          <div class="flex items-center gap-1.5">
            <div class="size-2.5 rounded-full" style="background: oklch(0.75 0.18 250)" />
            Main artist
          </div>
          <div class="flex items-center gap-1.5">
            <div class="size-2.5 rounded-full" style="background: oklch(0.7 0.15 330)" />
            Guest artist
          </div>
        </div>
      </div>
    </div>

    <div class="relative lg:col-span-4">
      <div
        v-if="loading"
        class="flex h-full min-h-[600px] items-center justify-center rounded-lg border border-rule bg-bg-1"
      >
        <div class="flex items-center gap-2 text-sm text-ink-2">
          <Loader2 :size="16" class="animate-spin text-accent" />
          Loading network...
        </div>
      </div>

      <div
        v-else-if="!graphData || graphData.nodes.length === 0"
        class="flex h-full min-h-[600px] items-center justify-center rounded-lg border border-rule bg-bg-1"
      >
        <p class="text-sm text-ink-2">
          {{ selectedArtist ? 'No collaborations found for this artist.' : 'No connections found. Try lowering the threshold.' }}
        </p>
      </div>

      <div
        v-else
        ref="svgContainer"
        class="h-full min-h-[600px] overflow-hidden rounded-lg border border-rule bg-bg-1"
      />
    </div>
  </div>

  <Teleport to="body">
    <div
      v-if="tooltip"
      class="pointer-events-none fixed z-[2000] rounded-lg border border-rule bg-bg-1 px-3 py-2 shadow-lg"
      :style="{
        left: `${tooltip.x + 12}px`,
        top: `${tooltip.y - 10}px`,
      }"
    >
      <div class="text-sm font-semibold text-ink">{{ tooltip.name }}</div>
      <div class="text-xs text-ink-2">
        {{ tooltip.tracks }} {{ tooltip.tracks === 1 ? 'track' : 'tracks' }}
        · {{ tooltip.isMain ? 'Main artist' : 'Guest artist' }}
      </div>
    </div>

    <div
      v-if="linkTooltip"
      class="pointer-events-none fixed z-[2000] max-w-xs rounded-lg border border-rule bg-bg-1 px-3 py-2 shadow-lg"
      :style="{
        left: `${linkTooltip.x + 12}px`,
        top: `${linkTooltip.y - 10}px`,
      }"
    >
      <div class="text-sm font-semibold text-ink">{{ linkTooltip.source }} × {{ linkTooltip.target }}</div>
      <div class="text-xs text-ink-2">{{ linkTooltip.shared }} shared tracks</div>
      <div v-if="linkTooltip.tracks.length > 0" class="mt-1 space-y-0.5">
        <div v-for="track in linkTooltip.tracks.slice(0, 5)" :key="track" class="truncate text-[10px] text-ink-2">
          {{ track }}
        </div>
        <div v-if="linkTooltip.tracks.length > 5" class="text-[10px] text-ink-2">
          +{{ linkTooltip.tracks.length - 5 }} more
        </div>
      </div>
    </div>
  </Teleport>
</template>
