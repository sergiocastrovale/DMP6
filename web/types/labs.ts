import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force'
import type { Tone } from './ui'

// One card on the /labs index (pages/labs/index.vue).
export interface Lab {
  to: string
  title: string
  description: string
  maturity: 'Stable' | 'Beta' | 'Experimental'
  tone: Tone
}

export interface MosaicItem {
  filename: string
  previewFilename: string | null
  createdAt: string
  size: number
  imageCount: number | null
}

export interface MosaicProgress {
  current: number
  total: number
}

export interface GenomeNode {
  id: string
  name: string
  artistCount: number
}

export interface GenomeLink {
  source: string
  target: string
  weight: number
}

export interface GenomeGraph {
  nodes: GenomeNode[]
  links: GenomeLink[]
}

// d3-force simulation shapes for pages/labs/genome.vue - the API's GenomeNode/GenomeLink plus the
// mutable x/y/vx/vy/index fields d3 attaches during simulation (SimulationNodeDatum/SimulationLinkDatum).
export interface GenomeGraphNode extends GenomeNode, SimulationNodeDatum {}
export interface GenomeGraphLink extends SimulationLinkDatum<GenomeGraphNode> {
  weight: number
}

export interface NetworkNode {
  id: string
  name: string
  slug: string
  trackCount: number
  isFocus: boolean
}

export interface NetworkLink {
  source: string
  target: string
  sharedTracks: number
  tracks: { id: string; title: string }[]
}

export interface NetworkGraph {
  nodes: NetworkNode[]
  links: NetworkLink[]
}

// d3-force simulation shapes for pages/labs/network.vue - see GenomeGraphNode/GenomeGraphLink above.
export interface NetworkGraphNode extends NetworkNode, SimulationNodeDatum {}
export interface NetworkGraphLink extends SimulationLinkDatum<NetworkGraphNode> {
  sharedTracks: number
  tracks: { id: string, title: string }[]
}

// Raw $queryRaw row shapes for server/api/labs/network/graph.get.ts.
export interface FullPairRow {
  main_artist_id: string
  related_artist_id: string
  shared_tracks: bigint
}

export interface FocusPairRow {
  other_artist_id: string
  shared_tracks: bigint
}

export interface NetworkTrackRow {
  artist_id: string
  track_id: string
  track_title: string
}

// Raw $queryRaw row shape for server/api/labs/map/countries.get.ts.
export interface CountryRow {
  country: string
  artist_count: string
  images: string[] | null
  image_urls: string[] | null
}

// Canvas-tiled cover texture built per-country by pages/labs/map.vue.
export interface MapTextureEntry {
  dataUrl: string
  cols: number
  rows: number
}

export interface MapCountry {
  name: string
  count: number
  images: { image: string | null; imageUrl: string | null }[]
}

// Raw $queryRaw row shapes for server/api/labs/decades/stats.get.ts.
export interface DecadeRow {
  decade: number
  release_count: bigint
  track_count: bigint
  artist_count: bigint
  avg_duration: number | null
  avg_bitrate: number | null
  total_play_count: bigint
}

export interface GenreRow {
  decade: number
  genre: string
  cnt: bigint
}

export interface DecadeStats {
  decade: string
  releaseCount: number
  trackCount: number
  artistCount: number
  avgDuration: number
  avgBitrate: number
  topGenres: { name: string; count: number }[]
  totalPlayCount: number
}
