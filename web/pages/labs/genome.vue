<script setup lang="ts">
import { Loader2, Dna } from 'lucide-vue-next'
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
import type { GenomeGraph } from '~/server/api/labs/genome/graph.get'

definePageMeta({ layout: 'labs' })

const { artistImage } = useImageUrl()

interface GraphNode extends SimulationNodeDatum {
  id: string
  name: string
  artistCount: number
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  weight: number
}

const { data: graphData, status } = useFetch<GenomeGraph>('/api/labs/genome/graph')

const svgContainer = ref<HTMLElement | null>(null)
const tooltip = ref<{ x: number; y: number; name: string; count: number } | null>(null)
const selectedNode = ref<GraphNode | null>(null)

const dialogOpen = ref(false)
const dialogGenre = ref<{ id: string; name: string; count: number } | null>(null)
const dialogArtists = ref<any[]>([])
const dialogPage = ref(1)
const dialogHasMore = ref(false)
const dialogLoading = ref(false)

const minArtists = ref(2)
const minWeight = ref(1)

const filteredGraph = computed(() => {
  if (!graphData.value) {
    return { nodes: [], links: [] }
  }

  const nodes = graphData.value.nodes.filter((n) => n.artistCount >= minArtists.value)
  const nodeIds = new Set(nodes.map((n) => n.id))
  const links = graphData.value.links.filter(
    (l) => nodeIds.has(l.source) && nodeIds.has(l.target) && l.weight >= minWeight.value,
  )

  const connectedIds = new Set<string>()
  for (const link of links) {
    connectedIds.add(link.source)
    connectedIds.add(link.target)
  }

  return {
    nodes: nodes.filter((n) => connectedIds.has(n.id)),
    links,
  }
})

let simulation: ReturnType<typeof forceSimulation<GraphNode>> | null = null

const renderGraph = () => {
  if (!svgContainer.value || !filteredGraph.value.nodes.length) {
    return
  }

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

  const nodes: GraphNode[] = filteredGraph.value.nodes.map((n) => ({ ...n }))
  const links: GraphLink[] = filteredGraph.value.links.map((l) => ({
    source: l.source,
    target: l.target,
    weight: l.weight,
  }))

  const maxWeight = Math.max(...links.map((l) => l.weight), 1)
  const maxArtists = Math.max(...nodes.map((n) => n.artistCount), 1)

  const linkWidthScale = scaleLinear().domain([1, maxWeight]).range([0.5, 4])
  const linkOpacityScale = scaleLinear().domain([1, maxWeight]).range([0.15, 0.6])
  const nodeRadiusScale = scaleSqrt().domain([1, maxArtists]).range([4, 24])

  const linkElements = g
    .append('g')
    .selectAll('line')
    .data(links)
    .join('line')
    .attr('stroke', 'oklch(0.7 0.1 250)')
    .attr('stroke-width', (d: GraphLink) => linkWidthScale(d.weight))
    .attr('stroke-opacity', (d: GraphLink) => linkOpacityScale(d.weight))

  const nodeElements = g
    .append('g')
    .selectAll('circle')
    .data(nodes)
    .join('circle')
    .attr('r', (d: GraphNode) => nodeRadiusScale(d.artistCount))
    .attr('fill', 'oklch(0.75 0.18 250)')
    .attr('stroke', 'oklch(0.85 0.18 250)')
    .attr('stroke-width', 1.5)
    .attr('cursor', 'pointer')
    .on('mouseover', (event: MouseEvent, d: GraphNode) => {
      tooltip.value = { x: event.clientX, y: event.clientY, name: d.name, count: d.artistCount }
      select(event.currentTarget as Element).attr('fill', 'oklch(0.82 0.25 92)')
    })
    .on('mousemove', (event: MouseEvent) => {
      if (tooltip.value) {
        tooltip.value.x = event.clientX
        tooltip.value.y = event.clientY
      }
    })
    .on('mouseout', (event: MouseEvent) => {
      tooltip.value = null
      select(event.currentTarget as Element).attr('fill', 'oklch(0.75 0.18 250)')
    })
    .on('click', (_: MouseEvent, d: GraphNode) => {
      openGenreDialog(d)
    })

  const labelElements = g
    .append('g')
    .selectAll('text')
    .data(nodes)
    .join('text')
    .text((d: GraphNode) => d.name)
    .attr('font-size', (d: GraphNode) => Math.max(8, Math.min(12, nodeRadiusScale(d.artistCount) * 0.8)))
    .attr('fill', 'oklch(0.8 0 0)')
    .attr('text-anchor', 'middle')
    .attr('dy', (d: GraphNode) => nodeRadiusScale(d.artistCount) + 12)
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

  simulation = forceSimulation<GraphNode>(nodes)
    .force(
      'link',
      forceLink<GraphNode, GraphLink>(links)
        .id((d) => d.id)
        .distance((d) => 80 / Math.sqrt(d.weight))
        .strength((d) => Math.min(1, d.weight / maxWeight)),
    )
    .force('charge', forceManyBody().strength(-120))
    .force('center', forceCenter(0, 0))
    .force('collide', forceCollide<GraphNode>().radius((d) => nodeRadiusScale(d.artistCount) + 8))
    .on('tick', () => {
      linkElements
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y)

      nodeElements.attr('cx', (d: GraphNode) => d.x!).attr('cy', (d: GraphNode) => d.y!)

      labelElements.attr('x', (d: GraphNode) => d.x!).attr('y', (d: GraphNode) => d.y!)
    })
}

const fetchArtists = async (genreId: string, page: number) => {
  dialogLoading.value = true
  try {
    const data = await $fetch<any>('/api/labs/genome/artists', {
      query: { genreId, page, pageSize: 50 },
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

const openGenreDialog = (node: GraphNode) => {
  selectedNode.value = node
  dialogGenre.value = { id: node.id, name: node.name, count: node.artistCount }
  dialogArtists.value = []
  dialogPage.value = 1
  dialogHasMore.value = false
  dialogOpen.value = true
  fetchArtists(node.id, 1)
}

const loadMoreArtists = () => {
  if (!dialogLoading.value && dialogHasMore.value && dialogGenre.value) {
    fetchArtists(dialogGenre.value.id, dialogPage.value + 1)
  }
}

const onDialogScroll = (e: Event) => {
  const el = e.target as HTMLElement
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
    loadMoreArtists()
  }
}

watch(filteredGraph, () => {
  nextTick(renderGraph)
})

onMounted(() => {
  if (graphData.value) {
    nextTick(renderGraph)
  }
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
            <Dna :size="20" class="text-accent" />
          </div>
          <div>
            <h2 class="text-sm font-semibold text-ink">Genre Genome</h2>
            <p class="text-xs text-ink-2">Genre relationships via shared artists</p>
          </div>
        </div>

        <p class="mb-4 text-sm leading-relaxed text-ink-2">
          Each node is a genre. Lines connect genres that share artists — thicker lines mean more artists in common. Drag nodes to rearrange. Click a genre to see its artists.
        </p>

        <div class="space-y-4">
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-2">
              Min artists per genre: {{ minArtists }}
            </label>
            <input
              v-model.number="minArtists"
              type="range"
              :min="1"
              :max="20"
              class="w-full accent-accent"
            />
          </div>

          <div>
            <label class="mb-1 block text-xs font-medium text-ink-2">
              Min shared artists: {{ minWeight }}
            </label>
            <input
              v-model.number="minWeight"
              type="range"
              :min="1"
              :max="10"
              class="w-full accent-accent"
            />
          </div>
        </div>

        <div v-if="filteredGraph.nodes.length > 0" class="mt-4 text-xs text-ink-2">
          {{ filteredGraph.nodes.length }} genres · {{ filteredGraph.links.length }} connections
        </div>
      </div>
    </div>

    <div class="relative lg:col-span-4">
      <div
        v-if="status === 'pending'"
        class="flex h-full items-center justify-center rounded-lg border border-rule bg-bg-1"
      >
        <div class="flex items-center gap-2 text-sm text-ink-2">
          <Loader2 :size="16" class="animate-spin text-accent" />
          Loading genre data...
        </div>
      </div>

      <div
        v-else-if="filteredGraph.nodes.length === 0"
        class="flex h-full items-center justify-center rounded-lg border border-rule bg-bg-1"
      >
        <p class="text-sm text-ink-2">No genres match current filters. Try lowering thresholds.</p>
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
        {{ tooltip.count }} {{ tooltip.count === 1 ? 'artist' : 'artists' }}
      </div>
    </div>
  </Teleport>

  <Dialog
    v-model="dialogOpen"
    :title="dialogGenre ? `${dialogGenre.name} (${dialogGenre.count})` : ''"
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
</template>
