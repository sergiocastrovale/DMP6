export interface MosaicItem {
  filename: string
  previewFilename: string | null
  createdAt: string
  size: number
  imageCount: number | null
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

export interface MapCountry {
  name: string
  count: number
  images: { image: string | null; imageUrl: string | null }[]
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
