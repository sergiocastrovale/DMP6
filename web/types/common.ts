import type { Ref } from 'vue'
import type { Release } from './release'
import type { PlaylistSummary } from './playlist'

// Dashboard homepage section (pages/index.vue) - a titled row of either releases or playlists.
export type DashboardSection =
  | { title: string, type: 'release', items: Ref<Release[]> }
  | { title: string, type: 'playlist', items: Ref<PlaylistSummary[]> }

export interface ArtistRef {
  id: string
  name: string
  slug: string
}

export interface ArtistSummary extends ArtistRef {
  image: string | null
  imageUrl: string | null
}

export interface ReleaseRef {
  id: string
  title: string
  year: number | null
  image: string | null
  imageUrl: string | null
}

export interface TrackInContext {
  id: string
  title: string
  trackNumber: number | null
  duration: number | null
  release: (ReleaseRef & { artist: ArtistRef | null }) | null
}

export type PlaylistType = 'MANUAL' | 'GENRE' | 'REGION'

export interface BrowseFilterParam {
  key: string
  storeKey: keyof ReturnType<typeof import('~/stores/browse').useBrowseStore>
  default?: string
  type?: 'number'
}

export type SortDirection = 'asc' | 'desc'

// sRGB 8-bit triplet, used by the design-token WCAG contrast test helpers (test/helpers/colorMath.ts).
export type Rgb = [number, number, number]

// One `event: <type>\ndata: <payload>\n\n` SSE frame, shared by stores/terminal.ts and stores/mosaic.ts.
export interface SseEvent {
  event: string
  data: string
}

// Fixture row shape for test/components/DataTable.test.ts.
export interface DataTableTestArtist {
  id: string
  name: string
  releases: number
}

// test/components/explore/History.test.ts helper alias.
export type TestButtons = import('@vue/test-utils').DOMWrapper<HTMLButtonElement>[]
