import type { Component } from 'vue'

export interface ButtonDropdownOption {
  label: string
  description?: string
  icon?: Component
  action: () => void
}

export interface TrackListColumn {
  key: 'play' | 'release' | 'trackNumber' | 'title' | 'artist' | 'status' | 'playCount' | 'favorite' | 'duration'
  label?: string
}
