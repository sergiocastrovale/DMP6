import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide } from 'd3-force'
import { scaleLinear, scaleSqrt } from 'd3-scale'
import { select } from 'd3-selection'
import { drag as d3Drag } from 'd3-drag'
import { zoom as d3Zoom, zoomIdentity } from 'd3-zoom'
import type { NetworkGraph, NetworkGraphNode as GraphNode, NetworkGraphLink as GraphLink } from '~/types/labs'
import { cssVar } from '~/helpers/theme'
import {
  FOCUS_RADIUS_FACTOR, centerStrength, chargeStrength, graphMetrics, labelFontSize, linkDistance, linkStrength,
} from '~/helpers/networkGraph'

// Draws the artist-network graph into `container` with d3 (SVG, force layout, zoom and drag) whenever `graph` changes,
// and reports hover state for the tooltips. What a node click does is the page's business.
export const useForceGraph = (
  container: Ref<HTMLElement | null>,
  graph: Ref<NetworkGraph | null>,
  options: { onNodeClick: (node: GraphNode) => void },
) => {
  const tooltip = ref<{ x: number, y: number, name: string, tracks: number } | null>(null)
  const linkTooltip = ref<{ x: number, y: number, source: string, target: string, shared: number, tracks: string[] } | null>(null)

  let simulation: ReturnType<typeof forceSimulation<GraphNode>> | null = null

  const render = () => {
    if (!container.value || !graph.value || graph.value.nodes.length === 0) {
      return
    }

    simulation?.stop()
    const el = container.value
    el.innerHTML = ''

    const width = el.clientWidth
    const height = el.clientHeight

    const svg = select(el).append('svg').attr('width', width).attr('height', height)
    const g = svg.append('g')

    const zoomBehavior = d3Zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 5])
      .on('zoom', (event) => {
        g.attr('transform', event.transform)
      })

    svg.call(zoomBehavior as never)
    svg.call(zoomBehavior.transform as never, zoomIdentity.translate(width / 2, height / 2).scale(0.8))

    const nodes: GraphNode[] = graph.value.nodes.map(n => ({ ...n }))
    const links: GraphLink[] = graph.value.links.map(l => ({
      source: l.source,
      target: l.target,
      sharedTracks: l.sharedTracks,
      tracks: l.tracks,
    }))

    const { maxShared, maxTracks } = graphMetrics(nodes, links)
    const linkWidthScale = scaleLinear().domain([1, maxShared]).range([0.8, 6])
    const linkOpacityScale = scaleLinear().domain([1, maxShared]).range([0.2, 0.8])
    const nodeRadiusScale = scaleSqrt().domain([1, maxTracks]).range([5, 24])
    const radiusOf = (d: GraphNode) => d.isFocus ? nodeRadiusScale(d.trackCount) * FOCUS_RADIUS_FACTOR : nodeRadiusScale(d.trackCount)

    const nodeMap = new Map(nodes.map(n => [n.id, n]))
    const endpoint = (end: GraphLink['source']): GraphNode | undefined => typeof end === 'object' ? end as GraphNode : nodeMap.get(String(end))

    const linkElements = g
      .append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', `color-mix(in oklch, ${cssVar('--color-stone-100')} 40%, transparent)`)
      .attr('stroke-width', d => linkWidthScale(d.sharedTracks))
      .attr('stroke-opacity', d => linkOpacityScale(d.sharedTracks))
      .attr('cursor', 'pointer')
      .on('mouseover', (event: MouseEvent, d) => {
        linkTooltip.value = {
          x: event.clientX,
          y: event.clientY,
          source: endpoint(d.source)?.name || '',
          target: endpoint(d.target)?.name || '',
          shared: d.sharedTracks,
          tracks: (d.tracks || []).map(t => t.title),
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
      .attr('r', radiusOf)
      .attr('fill', d => d.isFocus ? cssVar('--color-orange-400') : cssVar('--color-amber-400'))
      .attr('stroke', d => d.isFocus ? cssVar('--color-orange-300') : cssVar('--color-amber-300'))
      .attr('stroke-width', d => d.isFocus ? 3 : 1.5)
      .attr('cursor', 'pointer')
      .on('mouseover', (event: MouseEvent, d) => {
        tooltip.value = { x: event.clientX, y: event.clientY, name: d.name, tracks: d.trackCount }
        if (!d.isFocus) {
          select(event.currentTarget as Element).attr('fill', cssVar('--color-orange-400'))
        }
      })
      .on('mousemove', (event: MouseEvent) => {
        if (tooltip.value) {
          tooltip.value.x = event.clientX
          tooltip.value.y = event.clientY
        }
      })
      .on('mouseout', (event: MouseEvent, d) => {
        tooltip.value = null
        if (!d.isFocus) {
          select(event.currentTarget as Element).attr('fill', cssVar('--color-amber-400'))
        }
      })
      .on('click', (_: MouseEvent, d) => options.onNodeClick(d))

    const labelElements = g
      .append('g')
      .selectAll('text')
      .data(nodes)
      .join('text')
      .text(d => d.name)
      .attr('font-size', d => labelFontSize(nodeRadiusScale(d.trackCount), !!d.isFocus))
      .attr('font-weight', d => d.isFocus ? 'bold' : 'normal')
      .attr('fill', `color-mix(in oklch, ${cssVar('--color-stone-100')} 75%, transparent)`)
      .attr('text-anchor', 'middle')
      .attr('dy', d => radiusOf(d) + 12)
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

    nodeElements.call(dragBehavior as never)

    const focusNode = nodes.find(n => n.isFocus)
    const hasFocus = !!focusNode
    if (focusNode) {
      focusNode.fx = 0
      focusNode.fy = 0
    }

    simulation = forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        forceLink<GraphNode, GraphLink>(links)
          .id(d => d.id)
          .distance(d => linkDistance(d.sharedTracks, hasFocus))
          .strength(d => linkStrength(d.sharedTracks, maxShared)),
      )
      .force('charge', forceManyBody().strength(chargeStrength(hasFocus)))
      .force('center', forceCenter(0, 0).strength(centerStrength(hasFocus)))
      .force('collide', forceCollide<GraphNode>().radius(d => nodeRadiusScale(d.trackCount) + 10))
      .on('tick', () => {
        linkElements
          .attr('x1', d => (d.source as GraphNode).x!)
          .attr('y1', d => (d.source as GraphNode).y!)
          .attr('x2', d => (d.target as GraphNode).x!)
          .attr('y2', d => (d.target as GraphNode).y!)

        nodeElements.attr('cx', d => d.x!).attr('cy', d => d.y!)
        labelElements.attr('x', d => d.x!).attr('y', d => d.y!)
      })

    // The focus node is pinned to the centre while the layout settles, then let go.
    if (focusNode) {
      setTimeout(() => {
        focusNode.fx = null
        focusNode.fy = null
      }, 2000)
    }
  }

  // The container only exists once the loading state has cleared, so draw after the DOM update.
  watch(graph, () => nextTick(render))

  onUnmounted(() => {
    simulation?.stop()
    simulation = null
  })

  return { tooltip, linkTooltip }
}
