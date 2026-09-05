import type { Component } from 'vue'
import type { TrackInContext, PlaylistType } from './common'

interface PlaylistBase {
  id: string
  name: string
  slug: string
  description: string | null
  type: PlaylistType
  genreGroup: string | null
  regionGroup: string | null
  createdAt: Date
  updatedAt: Date
}

export interface PlaylistSummary extends PlaylistBase {
  trackCount: number
  coverImages: Array<{
    image: string | null
    imageUrl: string | null
  }>
}

export interface PlaylistTrack {
  id: string
  position: number
  addedAt: Date
  track: TrackInContext
}

export interface PlaylistDetail extends PlaylistBase {
  tracks: PlaylistTrack[]
}

export interface PlaylistSection {
  type: PlaylistSummary['type']
  label?: string
  icon: Component
  popoverTitle?: string
  popoverText?: string
  items: import('vue').ComputedRef<PlaylistSummary[]>
}
