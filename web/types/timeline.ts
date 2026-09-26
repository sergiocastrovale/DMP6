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

// The releases of one year, with that year's full count (which can exceed what has loaded so far).
export interface TimelineYearGroup {
  year: number
  releases: TimelineRelease[]
  count: number
}
