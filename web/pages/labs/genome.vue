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
import type { GenomeGraph } from '~/types/labs'
import { cssVar } from '~/helpers/theme'
import { typography } from '~/helpers/ui'

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
    .attr('stroke', `color-mix(in oklch, ${cssVar('--color-stone-100')} 40%, transparent)`)
    .attr('stroke-width', (d: GraphLink) => linkWidthScale(d.weight))
    .attr('stroke-opacity', (d: GraphLink) => linkOpacityScale(d.weight))

  const nodeElements = g
    .append('g')
    .selectAll('circle')
    .data(nodes)
    .join('circle')
    .attr('r', (d: GraphNode) => nodeRadiusScale(d.artistCount))
    .attr('fill', cssVar('--color-amber-400'))
    .attr('stroke', cssVar('--color-amber-300'))
    .attr('stroke-width', 1.5)
    .attr('cursor', 'pointer')
    .on('mouseover', (event: MouseEvent, d: GraphNode) => {
      tooltip.value = { x: event.clientX, y: event.clientY, name: d.name, count: d.artistCount }
      select(event.currentTarget as Element).attr('fill', cssVar('--color-orange-400'))
    })
    .on('mousemove', (event: MouseEvent) => {
      if (tooltip.value) {
        tooltip.value.x = event.clientX
        tooltip.value.y = event.clientY
      }
    })
    .on('mouseout', (event: MouseEvent) => {
      tooltip.value = null
      select(event.currentTarget as Element).attr('fill', cssVar('--color-amber-400'))
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
    .attr('fill', `color-mix(in oklch, ${cssVar('--color-stone-100')} 70%, transparent)`)
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
  <div class="flex flex-col gap-4">
    <LabsBackLink />

    <div class="grid gap-6 lg:grid-cols-5">
      <div class="flex flex-col gap-6 lg:col-span-1">
        <div class="rounded-xl border border-stone-100/6 bg-stone-900 p-5">
          <div class="mb-4 flex items-center gap-3">
            <div class="flex size-10 items-center justify-center rounded-lg bg-amber-400/10">
              <Dna :size="20" class="text-amber-400" />
            </div>
            <div>
              <h2 class="text-lg font-semibold text-stone-100">Genre Genome</h2>
              <p class="text-sm text-stone-100/40">Genre relationships via shared artists</p>
            </div>
          </div>

          <p class="mb-4 text-base leading-relaxed text-stone-100/60">
            Each node is a genre. Lines connect genres that share artists - thicker lines mean more artists in common. Drag nodes to rearrange. Click a genre to see its artists.
          </p>

          <div class="flex flex-col gap-4">
            <Slider v-model="minArtists" title="Min artists per genre" :min="1" :max="20" />
            <Slider v-model="minWeight" title="Min shared artists" :min="1" :max="10" />
          </div>

          <div v-if="filteredGraph.nodes.length > 0" :class="[typography.meta, 'mt-4']">
            {{ filteredGraph.nodes.length }} genres · {{ filteredGraph.links.length }} connections
          </div>
        </div>
      </div>

      <div class="relative lg:col-span-4">
        <div
          v-if="status === 'pending'"
          class="flex h-full items-center justify-center rounded-xl border border-stone-100/6 bg-stone-900"
        >
          <div class="flex items-center gap-2 text-base text-stone-100/60">
            <Loader2 :size="16" class="animate-spin text-amber-400" />
            Loading genre data...
          </div>
        </div>

        <UiEmptyState
          v-else-if="filteredGraph.nodes.length === 0"
          message="No genres match current filters. Try lowering thresholds."
          class="h-full rounded-xl border border-stone-100/6 bg-stone-900"
        />

        <div
          v-else
          ref="svgContainer"
          class="h-full min-h-[600px] overflow-hidden rounded-xl border border-stone-100/6 bg-stone-900"
        />
      </div>
    </div>

    <Teleport to="body">
      <div
        v-if="tooltip"
        class="pointer-events-none fixed z-[2000] rounded-lg border border-stone-100/10 bg-stone-900 px-3 py-2 shadow-lg"
        :style="{
          left: `${tooltip.x + 12}px`,
          top: `${tooltip.y - 10}px`,
        }"
      >
        <div class="text-base font-semibold text-stone-100">{{ tooltip.name }}</div>
        <div class="text-sm text-stone-100/60">
          {{ tooltip.count }} {{ tooltip.count === 1 ? 'artist' : 'artists' }}
        </div>
      </div>
    </Teleport>

    <Dialog
      v-model="dialogOpen"
      :title="dialogGenre ? `${dialogGenre.name} (${dialogGenre.count})` : ''"
      max-width="lg"
    >
      <div class="-mx-6 -my-4 max-h-[70vh] overflow-y-auto px-6 py-4">
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          <Block
            v-for="artist in dialogArtists"
            :id="artist.id"
            :key="artist.id"
            :title="artist.name"
            :image="artistImage(artist)"
            :link="`/artist/${artist.slug}`"
          />
        </div>
        <InfiniteScroll margin="100px" @load="loadMoreArtists" />
        <div v-if="dialogLoading" class="py-6 text-center text-base text-stone-100/60">
          Loading...
        </div>
        <UiEmptyState v-if="!dialogLoading && dialogArtists.length === 0" message="No artists found" />
      </div>
    </Dialog>
  </div>
</template>