import type { Release } from './release'

export interface Decade {
  decade: number
  count: number
}

export interface YearCount {
  year: number
  count: number
}

export type TimelineRelease = Omit<Release, 'genre'>

export interface DecadeResponse {
  releases: TimelineRelease[]
  total: number
  page: number
  hasMore: boolean
  years: YearCount[]
}
